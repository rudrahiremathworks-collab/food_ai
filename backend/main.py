from fastapi import FastAPI, UploadFile, File, HTTPException, Depends, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel
import pandas as pd
import numpy as np
import shutil
import os
import json
import logging
from typing import Dict, Optional, List, Tuple

from .database import engine, Base, get_db
from .models import PredictionLog, ModelMetrics
from .ml_pipeline import (
    train_and_save_model,
    predict_data,
    FEATURES,
    BASE_FEATURES,
    QUALITY_FEATURES,
    load_models,
    load_thresholds,
)

logger = logging.getLogger(__name__)

def run_db_migrations(engine):
    """Safely and idempotently adds missing V2 columns to the prediction_logs table."""
    import sqlite3
    import logging

    logger = logging.getLogger("DBMigration")
    logger.setLevel(logging.INFO)
    if not logger.handlers:
        ch = logging.StreamHandler()
        ch.setFormatter(logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s'))
        logger.addHandler(ch)

    try:
        db_url = str(engine.url)
        if db_url.startswith("sqlite:///"):
            db_path = db_url.replace("sqlite:///", "")
        else:
            db_path = engine.url.database

        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()

        # Check existing columns using SQLite PRAGMA
        cursor.execute("PRAGMA table_info(prediction_logs)")
        columns_info = cursor.fetchall()
        existing_columns = {row[1] for row in columns_info}

        columns_to_add = [
            ("product_type", "TEXT"),
            ("package_status", "TEXT"),
            ("oxidation_rate", "REAL"),
            ("product_status", "TEXT"),
            ("rejection_reasons", "TEXT"),
            ("overall_acceptability", "REAL")
        ]

        migrated_cols = []
        for col_name, col_type in columns_to_add:
            if col_name not in existing_columns:
                cursor.execute(f"ALTER TABLE prediction_logs ADD COLUMN {col_name} {col_type}")
                migrated_cols.append(col_name)
                logger.info(f"Database Migration: Column '{col_name}' ADDED to prediction_logs table.")

        conn.commit()
        conn.close()

        if migrated_cols:
            logger.info(f"Database Migration completed successfully for columns: {', '.join(migrated_cols)}")
        else:
            logger.info("Database Migration: skipped. All columns already exist.")

    except Exception as e:
        logger.error(f"Database Migration failed: {str(e)}")


Base.metadata.create_all(bind=engine)
run_db_migrations(engine)

app = FastAPI(title="ShelfLife AI API")

allowed_origins_env = os.getenv("ALLOWED_ORIGINS")
if allowed_origins_env:
    allow_origins = [origin.strip() for origin in allowed_origins_env.split(",") if origin.strip()]
else:
    allow_origins = ["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:3000"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from fastapi.responses import JSONResponse
import traceback

@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    log_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "error_log.txt")
    try:
        with open(log_path, "a") as f:
            f.write(f"Exception during request to {request.url.path}:\n")
            traceback.print_exc(file=f)
            f.write("\n" + "="*80 + "\n")
    except Exception as log_err:
        logger.error(f"Failed to log exception: {log_err}")
    
    return JSONResponse(
        status_code=500,
        content={"detail": f"Internal Server Error: {str(exc)}", "traceback": traceback.format_exc()},
    )

UPLOAD_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

MAPPING_SUGGESTIONS = {
    "Retort_Temperature": ["retort_temperature", "retort_temp", "retorttemp", "retort", "temp_c"],
    "Holding_Time": ["holding_time", "holdingtime", "holding_time_min", "holding_min", "hold_time", "holdtime", "holdtimemin"],
    "F0": ["f0", "f0_value", "f0value"],
    "Storage_Temperature": ["storage_temperature", "storage_temp", "storagetemp", "temp", "temperature", "temp_c"],
    "Storage_Day": ["storage_day", "storage_days", "storageday", "storagedays", "storage_time_in_days", "storagetimeindays", "day", "days"],
    "pH": ["ph", "ph_value", "phvalue", "acidity"],
    "PV": ["pv", "pv_value", "peroxide", "peroxide_value"],
    "TPC": ["tpc", "tpc_value", "bacteria", "microbial_count", "microbial", "tvc_tpc", "tvc", "tvc_tpc_count"],
    "O2": ["o2", "oxygen", "o2_%"],
    "CO2": ["co2", "carbon_dioxide", "carbondioxide", "co2_%"],
    "Moisture_Content": ["moisture_content", "moisture", "moisturecontent", "moisture_%", "moisture_content_%"],
    "L_Value": ["l_value", "lvalue", "l", "l*"],
    "a_Value": ["a_value", "avalue", "a", "a*"],
    "b_Value": ["b_value", "bvalue", "b", "b*"],
    "Product_Type": ["product_type", "producttype", "type", "product_type_selection"],
    "Sample_ID": ["sample_id", "sampleid", "sample_code", "samplecode", "sample", "sample_name", "samplename"],
    "Package_Status": ["package_status", "packagestatus", "pouch_condition", "pouchcondition", "package_condition", "packagecondition"],
    "Overall_Acceptability": ["overall_acceptability", "overallacceptability", "overall_acceptability_score", "sensory_acceptability", "overall_sensory_index", "overall", "acceptability", "osi"],
}

import re

def parse_sample_id_product_type(sample_id_str) -> Optional[str]:
    """Inspects Sample ID string to detect Retorted vs Unretorted using robust regex patterns.
    Priority 2 detection rules:
    - ends with / contains 'NRT' -> Unretorted
    - ends with / contains 'RT'  -> Retorted
    """
    if sample_id_str is None or pd.isnull(sample_id_str):
        return None
    s = str(sample_id_str).strip()
    if not s:
        return None

    # Check for NRT / Unretorted patterns (ends with NRT or contains _NRT / -NRT / space NRT)
    if re.search(r'(?:^|[\s_\-\d])NRT(?:$|[\s_\-\d])', s, re.IGNORECASE) or "unretort" in s.lower() or "non-retort" in s.lower():
        return "Unretorted"

    # Check for RT / Retorted patterns (ends with RT or contains _RT / -RT / space RT)
    if re.search(r'(?:^|[\s_\-\d])RT(?:$|[\s_\-\d])', s, re.IGNORECASE) or "retort" in s.lower():
        return "Retorted"

    return None


def resolve_row_product_type(row_idx, df: pd.DataFrame, col_mapping: dict, global_default: str) -> str:
    """Implements 3-priority Product_Type detection logic:
    Priority 1 (Highest): Mapped explicit 'Product_Type' column if present and valid.
    Priority 2: Inspect 'Sample ID' column if Product_Type column is absent.
    Priority 3 (Fallback): Global user-selected Product Type fallback.
    """
    pt_col = col_mapping.get("Product_Type")

    # Priority 1: Check explicit Product_Type column if mapped and present
    if pt_col and pt_col in df.columns:
        val = df.loc[row_idx, pt_col]
        if pd.notnull(val) and str(val).strip() != "":
            parsed = parse_sample_id_product_type(str(val))
            if parsed:
                return parsed
            try:
                validated_pt, _ = validate_metadata(str(val).strip(), "Normal")
                return validated_pt
            except Exception:
                pass

    # Priority 2: Inspect Sample ID column if Product_Type column is absent
    sample_id_col = col_mapping.get("Sample_ID") or col_mapping.get("Sample_Code")
    if not sample_id_col:
        for col in df.columns:
            normalized_name = normalize_str(col)
            if normalized_name in ["sampleid", "samplecode", "sample"]:
                sample_id_col = col
                break

    if sample_id_col and sample_id_col in df.columns:
        val = df.loc[row_idx, sample_id_col]
        parsed = parse_sample_id_product_type(val)
        if parsed:
            return parsed

    # Priority 3: Fallback to Global Product Type
    validated_global, _ = validate_metadata(global_default, "Normal")
    return validated_global


def normalize_str(s: str) -> str:
    return "".join(e for e in str(s).lower() if e.isalnum())


def suggest_mapping(df: pd.DataFrame) -> Dict[str, str]:
    columns = df.columns.tolist()
    mapping = {}
    normalized_cols = {col: normalize_str(col) for col in columns}

    def get_col_mean(col):
        try:
            return pd.to_numeric(df[col], errors='coerce').mean()
        except:
            return None

    # 1. Exact / Direct Normalized Matches
    for feature in FEATURES + ["Product_Type", "Package_Status", "Sample_ID"]:
        norm_feature = normalize_str(feature)
        match = next(
            (col for col, norm in normalized_cols.items() if norm == norm_feature),
            None
        )
        if match:
            mapping[feature] = match

    # 2. Smart Temperature Differentiation (Retort vs Storage)
    if "Retort_Temperature" not in mapping:
        # Check for retort keywords
        for col, norm in normalized_cols.items():
            if "retort" in norm:
                mapping["Retort_Temperature"] = col
                break
        # Fallback: if 'temp' in col name and mean value >= 60°C (processing temp)
        if "Retort_Temperature" not in mapping:
            for col, norm in normalized_cols.items():
                if "temp" in norm and "storage" not in norm:
                    mean_val = get_col_mean(col)
                    if mean_val is not None and mean_val >= 60:
                        mapping["Retort_Temperature"] = col
                        break

    if "Storage_Temperature" not in mapping:
        # Check for storage keywords
        for col, norm in normalized_cols.items():
            if "storage" in norm and "temp" in norm:
                mapping["Storage_Temperature"] = col
                break
        # Fallback: if 'temp' in col name, not assigned to Retort, and mean value < 60°C
        if "Storage_Temperature" not in mapping:
            for col, norm in normalized_cols.items():
                if "temp" in norm and col != mapping.get("Retort_Temperature"):
                    mean_val = get_col_mean(col)
                    if mean_val is None or mean_val < 60:
                        mapping["Storage_Temperature"] = col
                        break

    # 3. Alias Check for remaining features
    for feature in FEATURES + ["Product_Type", "Package_Status", "Sample_ID"]:
        if feature in mapping:
            continue
        suggestions = MAPPING_SUGGESTIONS.get(feature, [])
        match = next(
            (col for col, norm in normalized_cols.items() if norm in [normalize_str(s) for s in suggestions]),
            None
        )
        if match:
            mapping[feature] = match

    return mapping


def clean_nans(data):
    if isinstance(data, dict):
        return {k: clean_nans(v) for k, v in data.items()}
    elif isinstance(data, list):
        return [clean_nans(v) for v in data]
    elif isinstance(data, float) and (np.isnan(data) or np.isinf(data)):
        return None
    return data


class ManualPredictionRequest(BaseModel):
    Retort_Temperature: Optional[float] = None
    Holding_Time: Optional[float] = None
    F0: Optional[float] = None
    Storage_Temperature: Optional[float] = None
    Storage_Day: Optional[float] = None
    pH: Optional[float] = None
    PV: Optional[float] = None
    TPC: Optional[float] = None
    O2: Optional[float] = None
    CO2: Optional[float] = None
    Moisture_Content: Optional[float] = None
    L_Value: Optional[float] = None
    a_Value: Optional[float] = None
    b_Value: Optional[float] = None
    Overall_Acceptability: Optional[float] = None
    Product_Type: Optional[str] = "Retorted"
    Package_Status: Optional[str] = "Normal"


def validate_metadata(product_type: str, package_status: str):
    """Validates the Product_Type and Package_Status against active configuration thresholds."""
    thresholds = load_thresholds()
    if not thresholds:
        valid_pt = ["retorted", "unretorted"]
        valid_ps = ["Normal", "Seal_Failure", "Leakage", "Damaged_Package", "Bulged"]
    else:
        valid_pt = list(thresholds.get("product_types", {}).keys())
        valid_ps = thresholds.get("package_statuses", [])

    pt_str = str(product_type).strip()
    pt_lower = pt_str.lower()

    # Pattern matching for codes like 'A4 NRT' -> 'unretorted', 'A1 RT' -> 'retorted'
    if "nrt" in pt_lower or "unretort" in pt_lower or "non-retort" in pt_lower:
        pt_lower = "unretorted"
    elif "rt" in pt_lower or "retort" in pt_lower:
        pt_lower = "retorted"

    if pt_lower not in [p.lower() for p in valid_pt]:
        supported_str = ", ".join(p.capitalize() for p in valid_pt)
        raise HTTPException(
            status_code=400,
            detail=f"Invalid Product_Type '{product_type}'. Supported: {supported_str}"
        )

    matched_pt = next(p.capitalize() for p in valid_pt if p.lower() == pt_lower)

    if package_status not in valid_ps:
        supported_str = ", ".join(valid_ps)
        raise HTTPException(
            status_code=400,
            detail=f"Invalid Package_Status '{package_status}'. Supported: {supported_str}"
        )

    return matched_pt, package_status


def parse_numeric(val) -> Optional[float]:
    """Safely converts string/number/float to float. Returns None for NaN, None, empty, ND."""
    if val is None or pd.isnull(val):
        return None
    try:
        s = str(val).strip().upper()
        if not s or s in ["NAN", "NONE", "NULL", "N/A"]:
            return None
        if "ND" in s:
            return 0.0
        if "TNTC" in s:
            return 99999.0
        m = re.search(r"[-+]?\d*\.\d+|\d+", s)
        if m:
            return float(m.group())
        return float(val)
    except Exception:
        return None


def validate_quality_acceptance(
    row_data: dict,
    product_type: str = "Retorted",
    package_status: str = "Normal",
    overall_acceptability: Optional[float] = None,
    initial_moisture: Optional[float] = None,
    is_manual: bool = False
) -> Tuple[str, List[str]]:
    """
    Quality Acceptance Validation Layer.
    Executes AFTER ML prediction and evaluates ONLY supplied/actual measurement values.
    Missing / blank / NaN values are NOT evaluated and NEVER cause rejection.
    """
    from typing import List, Tuple
    reasons = []

    pt_str = str(product_type).strip().lower()
    if "nrt" in pt_str or "unretort" in pt_str or "non-retort" in pt_str:
        pt = "unretorted"
    else:
        pt = "retorted"

    # 1. Package Failure Rule
    ps_str = str(package_status).strip().lower().replace("_", " ")
    package_failures = ["seal failure", "leakage", "bulging", "bulged", "damaged package", "damaged pouch"]
    if ps_str in package_failures:
        formatted_ps = str(package_status).replace("_", " ")
        reasons.append(f"Package failure: {formatted_ps}")

    # 2. PV Rule (PV <= 10)
    pv = parse_numeric(row_data.get("PV"))
    if pv is not None:
        if pv > 10.0:
            reasons.append(f"PV exceeded acceptable limit ({pv} > 10)")

    # 3. TPC Rule (Retorted: TPC <= 0; Unretorted: TPC <= 5)
    tpc = parse_numeric(row_data.get("TPC"))
    if tpc is not None:
        if pt == "retorted":
            if tpc > 0.0:
                reasons.append(f"TPC exceeded acceptable limit ({tpc} > 0)")
        else:
            if tpc > 5.0:
                reasons.append(f"TPC exceeded acceptable limit ({tpc} > 5)")

    # 4. pH Rule (pH >= 4.9)
    ph = parse_numeric(row_data.get("pH"))
    if ph is not None:
        if ph < 4.9:
            reasons.append(f"pH below acceptable limit ({ph} < 4.9)")

    # 5. Moisture Rule (Retorted only: relative change <= 10% from actual sample initial moisture baseline)
    mc = parse_numeric(row_data.get("Moisture_Content"))
    if mc is not None and pt == "retorted":
        init_m = parse_numeric(initial_moisture) if initial_moisture is not None else parse_numeric(row_data.get("Initial_Moisture"))
        if init_m is not None and init_m > 0:
            pct_change = abs(mc - init_m) / init_m * 100.0
            if pct_change > 10.0:
                reasons.append(f"Moisture relative change exceeded 10% limit ({pct_change:.1f}% change from initial {init_m:.2f}%)")
        elif is_manual:
            base = 68.0
            pct_change = abs(mc - base) / base * 100.0
            if pct_change > 10.0:
                reasons.append(f"Moisture relative change exceeded 10% limit ({mc}% outside {base*0.9:.1f}% - {base*1.1:.1f}%)")
        else:
            # Missing experimental baseline -> DO NOT REJECT
            pass

    # 6. O2 Rule (O2 <= 25)
    o2 = parse_numeric(row_data.get("O2"))
    if o2 is not None:
        if o2 > 25.0:
            reasons.append(f"O2 exceeded acceptable limit ({o2}% > 25%)")

    # 7. CO2 Rule (CO2 <= 25)
    co2 = parse_numeric(row_data.get("CO2"))
    if co2 is not None:
        if co2 > 25.0:
            reasons.append(f"CO2 exceeded acceptable limit ({co2}% > 25%)")

    # 8. Overall Acceptability Rule (Overall Acceptability >= 5)
    oa_raw = overall_acceptability if overall_acceptability is not None else row_data.get("Overall_Acceptability")
    oa = parse_numeric(oa_raw)
    if oa is not None:
        if oa < 5.0:
            reasons.append(f"Overall Acceptability below acceptable limit ({oa} < 5)")

    status = "ACCEPTABLE" if len(reasons) == 0 else "REJECTED"
    return status, reasons


def calculate_oxidation_rate(pv, storage_day):
    """Safely computes Oxidation_Rate = PV / Storage_Day without division by zero or errors."""
    if pv is None or storage_day is None:
        return None
    try:
        pv_val = float(pv)
        day_val = float(storage_day)
        if np.isnan(pv_val) or np.isnan(day_val) or day_val <= 0:
            return None
        return pv_val / day_val
    except Exception:
        return None


@app.get("/health")
def health_check():
    _, shelf_life_pipeline = load_models()
    return {"status": "healthy", "model_loaded": shelf_life_pipeline is not None}


@app.post("/upload")
async def upload_file(file: UploadFile = File(...)):
    filename = file.filename.lower()
    if not (filename.endswith(".csv") or filename.endswith(".xlsx")):
        raise HTTPException(
            status_code=400,
            detail="Invalid file format.\n\nSupported:\nCSV (.csv)\nExcel (.xlsx)",
        )

    file_path = os.path.join(UPLOAD_DIR, file.filename)
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    try:
        if filename.endswith(".csv"):
            df = pd.read_csv(file_path)
        else:
            df = pd.read_excel(file_path)

        preview = clean_nans(df.head(10).to_dict(orient="records"))
        columns = df.columns.tolist()
        suggested = suggest_mapping(df)

        return {
            "filename": file.filename,
            "columns": columns,
            "row_count": len(df),
            "preview": preview,
            "suggested_mapping": suggested,
            "features": FEATURES,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error reading file: {str(e)}")


@app.post("/predict")
async def predict_endpoint(
    file: UploadFile = File(...),
    mapping: str = Form(...),
    product_type: Optional[str] = Form("Retorted"),
    package_status: Optional[str] = Form("Normal"),
    db: Session = Depends(get_db),
):
    filename = file.filename.lower()
    if not (filename.endswith(".csv") or filename.endswith(".xlsx")):
        raise HTTPException(
            status_code=400,
            detail="Invalid file format.\n\nSupported:\nCSV (.csv)\nExcel (.xlsx)",
        )

    # Validate global defaults
    product_type, package_status = validate_metadata(product_type, package_status)

    file_path = os.path.join(UPLOAD_DIR, "predict_" + file.filename)
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    try:
        if filename.endswith(".csv"):
            df = pd.read_csv(file_path)
        else:
            df = pd.read_excel(file_path)

        # Parse mapping
        col_mapping = json.loads(mapping)

        # Apply mapping
        mapped_df = pd.DataFrame()
        provided_fields_count = 0

        for feature in FEATURES:
            uploaded_col = col_mapping.get(feature)
            if uploaded_col and uploaded_col in df.columns:
                mapped_df[feature] = pd.to_numeric(df[uploaded_col], errors="coerce")
                provided_fields_count += 1
            else:
                mapped_df[feature] = np.nan

        # Validation rule: at least 2 parameters in the file
        if provided_fields_count < 2:
            raise HTTPException(
                status_code=400,
                detail="Please provide at least 2 parameters in your file.",
            )

        # Retrieve row-level mappings if mapped, otherwise fallback to endpoint default
        product_type_col = col_mapping.get("Product_Type")
        package_status_col = col_mapping.get("Package_Status")

        row_product_types = []
        row_package_statuses = []

        for idx in df.index:
            # Priority 1 (Product_Type col) -> Priority 2 (Sample_ID col) -> Priority 3 (Global default)
            row_pt = resolve_row_product_type(idx, df, col_mapping, product_type)
            row_product_types.append(row_pt)

            # Get row-specific package status or fallback to endpoint default
            row_ps = package_status
            if package_status_col and package_status_col in df.columns:
                val = df.loc[idx, package_status_col]
                if pd.notnull(val) and str(val).strip() != "":
                    row_ps = str(val).strip()
            _, row_ps = validate_metadata("Retorted", row_ps)
            row_package_statuses.append(row_ps)

        predictions, risk_levels, quality_df = predict_data(mapped_df, product_type=row_product_types)

        row_oxidation_rates = []
        row_product_statuses = []
        row_rejection_reasons = []
        row_overall_acceptabilities = []
        row_experimental_statuses = []

        # Build initial moisture lookup map from uploaded file per sample group
        sample_id_col = col_mapping.get("Sample_ID") or ("Sample ID" if "Sample ID" in df.columns else "Sample_ID")
        day_col = col_mapping.get("Storage_Day") or ("Storage Time in Days" if "Storage Time in Days" in df.columns else "Storage_Day")
        moist_col = col_mapping.get("Moisture_Content") or ("Moisture Content %" if "Moisture Content %" in df.columns else "Moisture_Content")

        initial_moisture_map = {}
        if sample_id_col in df.columns and moist_col in df.columns:
            for s_id, grp in df.groupby(sample_id_col):
                if pd.isnull(s_id): continue
                s_key = str(s_id).strip()
                if day_col in grp.columns:
                    days_parsed = grp[day_col].apply(parse_numeric)
                    min_day = days_parsed.min()
                    day0_rows = grp[days_parsed == min_day]
                else:
                    day0_rows = grp
                m_vals = [parse_numeric(v) for v in day0_rows[moist_col].dropna() if parse_numeric(v) is not None and parse_numeric(v) > 0]
                if m_vals:
                    initial_moisture_map[s_key] = float(np.mean(m_vals))

        status_col = None
        for c in ["Sample Status", "Sample_Status", "Experimental_Status", "Status"]:
            if c in df.columns:
                status_col = c
                break
        
        obs_col = None
        for c in ["Observation", "Observations"]:
            if c in df.columns:
                obs_col = c
                break

        # Update original df with predictions and also estimated quality values
        df["Shelf_Life"] = predictions
        df["Predicted_Shelf_Life"] = predictions
        df["Risk_Level"] = risk_levels

        for feature in QUALITY_FEATURES:
            df[f"Estimated_{feature}"] = quality_df[feature].values

        # Log to DB and collect row-level V2 values & acceptance statuses
        for idx, row in mapped_df.iterrows():
            row_pt = row_product_types[idx]
            row_ps = row_package_statuses[idx]

            # Extract client's original experimental status
            exp_status = "Acceptable"
            if status_col and pd.notnull(df.loc[idx, status_col]) and str(df.loc[idx, status_col]).strip() != "":
                exp_status = str(df.loc[idx, status_col]).strip()
            elif obs_col and pd.notnull(df.loc[idx, obs_col]) and str(df.loc[idx, obs_col]).strip() != "":
                exp_status = str(df.loc[idx, obs_col]).strip()
            row_experimental_statuses.append(exp_status)

            # Collect raw inputs provided for this row
            row_raw_inputs = {}
            for feat in FEATURES:
                uploaded_col = col_mapping.get(feat)
                if uploaded_col and uploaded_col in df.columns:
                    row_raw_inputs[feat] = df.loc[idx, uploaded_col]
                elif feat in df.columns:
                    row_raw_inputs[feat] = df.loc[idx, feat]

            oa_col = col_mapping.get("Overall_Acceptability")
            oa_val = None
            if oa_col and oa_col in df.columns:
                oa_val = df.loc[idx, oa_col]
            elif "Overall_Acceptability" in df.columns:
                oa_val = df.loc[idx, "Overall_Acceptability"]
            row_raw_inputs["Overall_Acceptability"] = oa_val
            row_overall_acceptabilities.append(oa_val)

            # Resolve initial moisture for this row's sample group
            row_s_id = None
            if sample_id_col in df.columns and pd.notnull(df.loc[idx, sample_id_col]):
                row_s_id = str(df.loc[idx, sample_id_col]).strip()
            row_init_moisture = initial_moisture_map.get(row_s_id) if row_s_id else None

            # Validate quality acceptance using actual supplied inputs ONLY
            p_status, p_reasons = validate_quality_acceptance(
                row_raw_inputs,
                product_type=row_pt,
                package_status=row_ps,
                overall_acceptability=oa_val,
                initial_moisture=row_init_moisture,
                is_manual=False
            )
            row_product_statuses.append(p_status)
            row_rejection_reasons.append("; ".join(p_reasons) if p_reasons else "")

            # Compute oxidation rate safely using final PV (user supplied or estimated) and Storage_Day
            final_pv = row.get("PV")
            if pd.isnull(final_pv):
                final_pv = quality_df.loc[idx, "PV"]
            
            final_day = row.get("Storage_Day")
            if pd.isnull(final_day):
                final_day = 0.0

            ox_rate = calculate_oxidation_rate(final_pv, final_day)
            row_oxidation_rates.append(ox_rate)

            # Save the first 100 rows to the database log
            if idx < 100:
                log = PredictionLog(
                    retort_temperature=float(
                        row.get("Retort_Temperature")
                        if pd.notnull(row.get("Retort_Temperature"))
                        else 0
                    ),
                    holding_time=float(
                        row.get("Holding_Time")
                        if pd.notnull(row.get("Holding_Time"))
                        else 0
                    ),
                    f0=float(row.get("F0") if pd.notnull(row.get("F0")) else 0),
                    storage_temperature=float(
                        row.get("Storage_Temperature")
                        if pd.notnull(row.get("Storage_Temperature"))
                        else 0
                    ),
                    storage_day=float(
                        row.get("Storage_Day") if pd.notnull(row.get("Storage_Day")) else 0
                    ),
                    ph=float(quality_df.loc[idx, "pH"]),
                    pv=float(quality_df.loc[idx, "PV"]),
                    tpc=float(quality_df.loc[idx, "TPC"]),
                    o2=float(quality_df.loc[idx, "O2"]),
                    co2=float(quality_df.loc[idx, "CO2"]),
                    moisture_content=float(quality_df.loc[idx, "Moisture_Content"]),
                    l_value=float(quality_df.loc[idx, "L_Value"]),
                    a_value=float(quality_df.loc[idx, "a_Value"]),
                    b_value=float(quality_df.loc[idx, "b_Value"]),
                    shelf_life_remaining=float(df.loc[idx, "Shelf_Life"]),
                    risk_level=str(df.loc[idx, "Risk_Level"]),
                    product_type=row_pt,
                    package_status=row_ps,
                    oxidation_rate=ox_rate,
                    product_status=p_status,
                    rejection_reasons="; ".join(p_reasons) if p_reasons else None,
                    overall_acceptability=parse_numeric(oa_val),
                )
                db.add(log)

        db.commit()

        # Add V2 output attributes to output response DataFrame for UI display & CSV export
        df["Product_Type"] = row_product_types
        df["Package_Status"] = row_package_statuses
        df["Oxidation_Rate"] = row_oxidation_rates
        df["Experimental_Status"] = row_experimental_statuses
        df["Software_Status"] = row_product_statuses
        df["Product_Status"] = row_product_statuses
        df["Rejection_Reason"] = row_rejection_reasons
        df["Overall_Acceptability"] = row_overall_acceptabilities

        return clean_nans(df.to_dict(orient="records"))
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/manual-predict")
def manual_predict(data: ManualPredictionRequest, db: Session = Depends(get_db)):
    try:
        # Filter out None values to let predict_data handle estimation
        input_dict = {k: v for k, v in data.dict().items() if v is not None}
        product_type = input_dict.pop("Product_Type", "Retorted")
        package_status = input_dict.pop("Package_Status", "Normal")

        # Validate metadata
        product_type, package_status = validate_metadata(product_type, package_status)

        # New Rule: Minimum 1 parameter
        if len(input_dict) < 1:
            raise HTTPException(
                status_code=400, detail="Please provide at least 1 parameter."
            )

        df = pd.DataFrame([input_dict])

        predictions, risk_levels, quality_df = predict_data(df, product_type=product_type)

        shelf_life = float(predictions[0])
        risk_level = risk_levels[0]
        estimated_quality = quality_df.iloc[0].to_dict()

        # Compute oxidation rate safely using final PV and Storage_Day
        pv_val = estimated_quality.get("PV")
        day_val = data.Storage_Day
        if day_val is None:
            day_val = 0.0

        ox_rate = calculate_oxidation_rate(pv_val, day_val)

        # Quality Acceptance Validation Layer using actual user inputs ONLY
        p_status, p_reasons = validate_quality_acceptance(
            data.dict(),
            product_type=product_type,
            package_status=package_status,
            overall_acceptability=data.Overall_Acceptability,
            is_manual=True
        )

        log = PredictionLog(
            retort_temperature=data.Retort_Temperature,
            holding_time=data.Holding_Time,
            f0=data.F0,
            storage_temperature=data.Storage_Temperature,
            storage_day=data.Storage_Day,
            ph=estimated_quality["pH"],
            pv=estimated_quality["PV"],
            tpc=estimated_quality["TPC"],
            o2=estimated_quality["O2"],
            co2=estimated_quality["CO2"],
            moisture_content=estimated_quality["Moisture_Content"],
            l_value=estimated_quality["L_Value"],
            a_value=estimated_quality["a_Value"],
            b_value=estimated_quality["b_Value"],
            shelf_life_remaining=shelf_life,
            risk_level=risk_level,
            product_type=product_type,
            package_status=package_status,
            oxidation_rate=ox_rate,
            product_status=p_status,
            rejection_reasons="; ".join(p_reasons) if p_reasons else None,
            overall_acceptability=data.Overall_Acceptability,
        )
        db.add(log)
        db.commit()

        return {
            "shelf_life": round(shelf_life, 1),
            "risk_level": risk_level,
            "product_status": p_status,
            "rejection_reasons": p_reasons,
            "estimated_quality": estimated_quality,
        }
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Technical error during prediction: {str(e)}")
        raise HTTPException(
            status_code=500, detail="Unable to process prediction. Please try again."
        )


@app.post("/estimate-quality")
def estimate_quality(data: ManualPredictionRequest):
    try:
        input_dict = {k: v for k, v in data.dict().items() if v is not None}
        product_type = input_dict.pop("Product_Type", "Retorted")
        package_status = input_dict.pop("Package_Status", "Normal")

        # Validate metadata
        product_type, package_status = validate_metadata(product_type, package_status)

        if len(input_dict) < 1:
            raise HTTPException(
                status_code=400, detail="Please provide at least 1 parameter."
            )

        # Default missing base features so they can be generated and returned
        defaults = {
            "Retort_Temperature": 121.0,
            "Holding_Time": 20.0,
            "F0": 25.0,
            "Storage_Temperature": 25.0,
            "Storage_Day": 0.0,
        }
        for k, v in defaults.items():
            if k not in input_dict:
                input_dict[k] = v

        df = pd.DataFrame([input_dict])

        _, _, quality_df = predict_data(df, product_type=product_type)

        # Merge the original inputs with the predicted ones for a full form set
        full_data = quality_df.iloc[0].to_dict()

        # --- CALIBRATION FIX ---
        temp = input_dict.get("Storage_Temperature", 25)
        days = input_dict.get("Storage_Day", 0)

        # Deterioration Rules based on User Cases
        if temp >= 45 or days >= 60:
            # Case 3: Extreme / Spoiled
            limits = {
                "pH": (4.8, 5.5),
                "PV": (5.0, 8.0),
                "TPC": (8.0, 10.0),
                "O2": (0.0, 4.0),
                "CO2": (12.0, 20.0),
                "L_Value": (45.0, 55.0),
                "a_Value": (8.0, 12.0),
                "b_Value": (14.0, 18.0),
                "Moisture_Content": (50.0, 60.0),
            }
        elif temp >= 35 or days >= 30:
            # Case 2: Moderate / Monitor (Target: 45-65 Days)
            limits = {
                "pH": (5.9, 6.4),
                "PV": (1.0, 2.0),
                "TPC": (1.5, 3.0),
                "O2": (12.0, 16.0),
                "CO2": (3.0, 6.0),
                "Moisture_Content": (60.0, 68.0),
                "L_Value": (60.0, 65.0),
                "a_Value": (4.0, 6.0),
                "b_Value": (11.0, 14.0),
            }
        elif temp >= 30 or days >= 15:
            # Case 1: Fresh-ish / Monitor (Target: 60-75 Days)
            limits = {
                "pH": (6.2, 6.6),
                "PV": (0.5, 1.2),
                "TPC": (0.8, 1.8),
                "O2": (15.0, 18.0),
                "CO2": (1.0, 3.0),
                "Moisture_Content": (65.0, 70.0),
                "L_Value": (63.0, 68.0),
                "a_Value": (4.0, 6.0),
                "b_Value": (12.0, 15.0),
            }
        else:
            # Super Fresh
            limits = {
                "pH": (6.7, 7.0),
                "PV": (0.3, 0.7),
                "TPC": (0.2, 1.0),
                "O2": (18.0, 21.0),
                "CO2": (0.0, 1.0),
                "Moisture_Content": (68.0, 72.0),
                "L_Value": (65.0, 75.0),
                "a_Value": (3.0, 5.0),
                "b_Value": (10.0, 14.0),
            }

        for key, (low, high) in limits.items():
            if key in full_data and key not in input_dict:
                full_data[key] = float(np.clip(full_data[key], low, high))

        for k, v in input_dict.items():
            full_data[k] = v

        return full_data
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Technical error during estimation: {str(e)}")
        raise HTTPException(
            status_code=500, detail="Unable to generate values. Please try again."
        )


@app.post("/retrain")
async def retrain_model(file_path: str):
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Dataset file not found")

    try:
        metrics = train_and_save_model(file_path)
        return {"status": "Model retrained successfully", "metrics": metrics}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/metrics")
def get_metrics(db: Session = Depends(get_db)):
    metrics = db.query(ModelMetrics).order_by(ModelMetrics.id.desc()).first()
    if not metrics:
        return {"mae": None, "rmse": None, "r2_score": None, "feature_importances": {}}

    return {
        "timestamp": metrics.timestamp,
        "mae": metrics.mae,
        "rmse": metrics.rmse,
        "r2_score": metrics.r2_score,
        "feature_importances": (
            json.loads(metrics.feature_importances)
            if metrics.feature_importances
            else {}
        ),
    }


@app.get("/logs")
def get_logs(db: Session = Depends(get_db)):
    logs = db.query(PredictionLog).order_by(PredictionLog.id.desc()).limit(100).all()
    return logs


@app.get("/thresholds")
def get_thresholds():
    thresholds = load_thresholds()
    if thresholds is None:
        raise HTTPException(
            status_code=500,
            detail="Quality thresholds configuration could not be loaded."
        )
    return thresholds


@app.get("/health")
def health_check():
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# Serve the built React frontend (for Railway single-service deployment)
# ---------------------------------------------------------------------------
_FRONTEND_DIST = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "frontend", "dist"
)

if os.path.isdir(_FRONTEND_DIST):
    # Mount static assets (JS, CSS, images, etc.)
    app.mount("/assets", StaticFiles(directory=os.path.join(_FRONTEND_DIST, "assets")), name="assets")

    @app.get("/{full_path:path}", response_class=HTMLResponse, include_in_schema=False)
    async def serve_spa(full_path: str):
        """Catch-all: serve index.html for any unknown path (React Router SPA)."""
        index_file = os.path.join(_FRONTEND_DIST, "index.html")
        with open(index_file, "r", encoding="utf-8") as f:
            return HTMLResponse(content=f.read())
