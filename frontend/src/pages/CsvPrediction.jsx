import { useState, useRef, useEffect } from "react";
import {
  UploadCloud,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Download,
  ChevronLeft,
  ChevronRight,
  FileType,
  Printer,
} from "lucide-react";
import axios from "axios";

const API = import.meta.env.VITE_API_URL ?? "";

const CsvPrediction = () => {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [results, setResults] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [mapping, setMapping] = useState({});
  const [isAutoMapped, setIsAutoMapped] = useState(false);
  const fileInputRef = useRef(null);

  const [globalProductType, setGlobalProductType] = useState("Retorted");
  const [globalPackageStatus, setGlobalPackageStatus] = useState("Normal");
  const [thresholds, setThresholds] = useState(null);

  useEffect(() => {
    axios
      .get(`${API}/thresholds`)
      .then((res) => {
        setThresholds(res.data);
      })
      .catch((err) => {
        console.error("Failed to load thresholds config in CsvPrediction, using static defaults.", err);
      });
  }, []);

  const productTypesList = thresholds?.product_types
    ? Object.keys(thresholds.product_types).map((key) => ({
        key,
        display_name: thresholds.product_types[key].display_name,
      }))
    : [
        { key: "retorted", display_name: "Retorted Products" },
        { key: "unretorted", display_name: "Unretorted Products" },
      ];

  const packageStatusList = thresholds?.package_statuses || [
    "Normal",
    "Seal_Failure",
    "Leakage",
    "Damaged_Package",
    "Bulged",
  ];

  const getHealthRecommendation = (level) => {
    switch (level) {
      case "Fresh":
        return {
          rec: "Safe for storage, distribution & retail display.",
          analysis: "Optimal microbial, pH, and oxygen balance.",
        };
      case "Monitor":
        return {
          rec: "Monitor storage temperature & days periodically.",
          analysis: "Initial quality degradation indicators observed.",
        };
      case "Near Spoilage":
        return {
          rec: "Prioritize distribution or inspect batch quality.",
          analysis: "Elevated microbial / chemical indicators.",
        };
      case "Spoiled":
        return {
          rec: "Immediate disposal or rejection recommended.",
          analysis: "Multiple parameters exceed safety thresholds.",
        };
      default:
        return { rec: "N/A", analysis: "N/A" };
    }
  };

  const getRiskColor = (level) => {
    if (level === "Fresh")
      return "text-green-400 bg-green-500/10 border-green-500/20";
    if (level === "Monitor")
      return "text-blue-400 bg-blue-500/10 border-blue-500/20";
    if (level === "Near Spoilage")
      return "text-orange-400 bg-orange-500/10 border-orange-500/20";
    if (level === "Spoiled")
      return "text-red-400 bg-red-500/10 border-red-500/20";
    return "text-slate-400 bg-slate-500/10 border-slate-500/20";
  };

  const executePrediction = async (fileToUse, mappingToUse) => {
    const f = fileToUse || file;
    const m = mappingToUse || mapping;
    if (!f) return;
    setLoading(true);
    const formData = new FormData();
    formData.append("file", f);
    formData.append("mapping", JSON.stringify(m));
    formData.append("product_type", globalProductType);
    formData.append("package_status", globalPackageStatus);
    try {
      const res = await axios.post(`${API}/predict`, formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      if (Array.isArray(res.data)) {
        setResults(res.data);
        setCurrentPage(1);
        setSuccess("Predictions & Health Analysis generated for all rows!");
        setTimeout(() => setSuccess(null), 3500);
      } else {
        setError("Invalid response format from prediction API.");
      }
    } catch (err) {
      const detail =
        err.response?.data?.detail ||
        (!err.response
          ? "Cannot connect to Backend Server (127.0.0.1:8000). Please ensure backend is running."
          : err.message || "Prediction failed");
      setError(detail);
    } finally {
      setLoading(false);
    }
  };

  const uploadForPreview = async (selectedFile) => {
    setLoading(true);
    const formData = new FormData();
    formData.append("file", selectedFile);
    try {
      const res = await axios.post(`${API}/upload`, formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      const data = res.data;
      setPreview(data);

      const suggested = data.suggested_mapping || {};
      setMapping(suggested);

      const matchedCount = Object.keys(suggested).length;
      const autoMapped = matchedCount >= 2;
      setIsAutoMapped(autoMapped);
      setError(null);

      if (autoMapped) {
        await executePrediction(selectedFile, suggested);
      }
    } catch (err) {
      const detail =
        err.response?.data?.detail ||
        (!err.response
          ? "Cannot connect to Backend Server (127.0.0.1:8000). Please ensure backend is running."
          : err.message || "Failed to upload file");
      setError(detail);
    } finally {
      setLoading(false);
    }
  };

  const handleFileChange = async (e) => {
    const selected = e.target.files[0];
    const validExtensions = [".csv", ".xlsx"];
    const isValid =
      selected &&
      validExtensions.some((ext) => selected.name.toLowerCase().endsWith(ext));

    if (isValid) {
      setFile(selected);
      setError(null);
      setResults(null);
      await uploadForPreview(selected);
    } else {
      setFile(null);
      setError(
        <div>
          <p className="font-bold">Invalid file format.</p>
          <p className="text-sm mt-1">Supported formats: CSV (.csv), Excel (.xlsx)</p>
        </div>,
      );
    }
  };

  const handlePredict = async () => {
    await executePrediction(file, mapping);
  };

  const handleDownload = () => {
    if (!Array.isArray(results) || results.length === 0) {
      setError("No results available for download.");
      return;
    }
    try {
      const columns = Object.keys(results[0]);
      const csvRows = [];
      csvRows.push(columns.join(","));
      results.forEach((row) => {
        const rowValues = columns.map((col) => {
          const val = row[col] !== undefined ? row[col] : "";
          const escaped = String(val).replace(/"/g, '""');
          return `"${escaped}"`;
        });
        csvRows.push(rowValues.join(","));
      });
      const csvString = csvRows.join("\n");
      const blob = new Blob([csvString], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `shelf_life_predictions_${new Date().toISOString().slice(0, 10)}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setSuccess("CSV Exported successfully!");
    } catch (err) {
      console.error("Export Error:", err);
      setError("Failed to generate CSV.");
    }
  };

  const handleExportPDF = () => {
    window.print();
  };

  // Metrics & Pagination calculation
  const totalRows = Array.isArray(results) ? results.length : 0;
  const acceptableCount = Array.isArray(results) ? results.filter((r) => r?.Product_Status === "ACCEPTABLE").length : 0;
  const rejectedCount = Array.isArray(results) ? results.filter((r) => r?.Product_Status === "REJECTED").length : 0;
  const freshCount = Array.isArray(results) ? results.filter((r) => r?.Risk_Level === "Fresh").length : 0;
  const monitorCount = Array.isArray(results) ? results.filter((r) => r?.Risk_Level === "Monitor").length : 0;
  const nearSpoilageCount = Array.isArray(results) ? results.filter((r) => r?.Risk_Level === "Near Spoilage").length : 0;
  const spoiledCount = Array.isArray(results) ? results.filter((r) => r?.Risk_Level === "Spoiled").length : 0;
  const avgShelfLife = Array.isArray(results) && totalRows > 0
    ? (results.reduce((acc, r) => acc + (Number(r?.Shelf_Life) || 0), 0) / totalRows).toFixed(1)
    : "0.0";

  const effectivePageSize = pageSize === "all" ? (totalRows || 1) : Number(pageSize || 50);
  const totalPages = Math.ceil(totalRows / effectivePageSize) || 1;
  const startIndex = (currentPage - 1) * effectivePageSize;
  const paginatedResults = Array.isArray(results) ? results.slice(startIndex, startIndex + effectivePageSize) : [];

  return (
    <div className="max-w-6xl mx-auto space-y-6 animate-in fade-in duration-500 p-4">
      <div>
        <h2 className="text-3xl font-bold">Batch Prediction & Health Analysis</h2>
        <p className="text-slate-400 mt-2">
          Upload bulk datasets for instant batch predictions and quality inspection reports. Supported formats: CSV (.csv), Excel (.xlsx)
        </p>
      </div>

      <div
        className={`border-2 border-dashed rounded-xl p-10 text-center transition-all ${
          file
            ? "border-emerald-500 bg-emerald-500/5"
            : "border-slate-600 hover:border-slate-400 bg-surface/50"
        }`}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            fileInputRef.current.files = e.dataTransfer.files;
            handleFileChange({ target: { files: e.dataTransfer.files } });
          }
        }}
      >
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileChange}
          accept=".csv,.xlsx"
          className="hidden"
        />

        {!file ? (
          <div
            className="flex flex-col items-center cursor-pointer"
            onClick={() => fileInputRef.current.click()}
          >
            <div className="bg-slate-800 p-4 rounded-full mb-4 text-slate-300">
              <UploadCloud size={32} />
            </div>
            <h3 className="text-lg font-medium mb-1">
              Click or drag and drop to upload
            </h3>
            <div className="text-sm text-slate-500 space-y-1">
              <p>Supported formats: CSV (.csv), Excel (.xlsx)</p>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center">
            <div className="bg-emerald-500/20 p-4 rounded-full mb-4 text-emerald-500">
              <FileType size={32} />
            </div>
            <h3 className="text-lg font-medium text-white">{file.name}</h3>
            <p className="text-sm text-slate-400 mt-1">
              {(file.size / 1024).toFixed(2)} KB
            </p>
            <button
              onClick={() => {
                setFile(null);
                setPreview(null);
                setResults(null);
              }}
              className="mt-4 text-sm text-red-400 hover:text-red-300 transition-colors"
            >
              Remove file
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-4 rounded-lg flex items-center gap-3">
          <AlertCircle size={20} />
          {error}
        </div>
      )}

      {success && (
        <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 p-4 rounded-lg flex items-center gap-3">
          <CheckCircle2 size={20} />
          {success}
        </div>
      )}

      {loading && (
        <div className="text-center p-8 bg-surface rounded-xl border border-white/5">
          <RefreshCw
            className="animate-spin mx-auto text-emerald-500 mb-4"
            size={32}
          />
          <p className="text-slate-300 font-medium text-lg">
            Processing Dataset & Calculating Health Predictions...
          </p>
          <p className="text-slate-500 text-sm mt-1">
            This might take a moment.
          </p>
        </div>
      )}

      {preview && !loading && !results && (
        <div className="space-y-6 animate-in slide-in-from-bottom-4">
          
          {/* Global Defaults Settings */}
          <div className="bg-surface rounded-xl border border-white/5 p-6 bg-white/[0.02] no-print">
            <h4 className="text-sm font-bold uppercase tracking-wider text-slate-300 mb-2">Global Batch Defaults</h4>
            <p className="text-xs text-slate-500 mb-6 font-medium">
              These defaults are applied only when Product_Type or Package_Status are not supplied by the uploaded dataset.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-[12px] font-bold text-slate-400 uppercase tracking-[0.5px]">Global Product Type</label>
                <div className="flex gap-2">
                  {productTypesList.map((typeObj) => {
                    const active = globalProductType.toLowerCase() === typeObj.key.toLowerCase();
                    return (
                      <button
                        key={typeObj.key}
                        type="button"
                        onClick={() => {
                          setGlobalProductType(typeObj.key === "retorted" ? "Retorted" : "Unretorted");
                          setResults(null);
                        }}
                        className={`flex-1 h-[38px] rounded-lg font-bold text-[11px] uppercase tracking-wider border transition-all ${
                          active
                            ? "bg-emerald-500 text-white border-emerald-500 shadow-md shadow-emerald-500/10"
                            : "bg-slate-900/40 text-slate-400 border-white/10 hover:bg-slate-900/60"
                        }`}
                      >
                        {typeObj.display_name}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-[12px] font-bold text-slate-400 uppercase tracking-[0.5px]">Global Package Status</label>
                <select
                  value={globalPackageStatus}
                  onChange={(e) => {
                    setGlobalPackageStatus(e.target.value);
                    setResults(null);
                  }}
                  className="w-full bg-slate-950/40 border border-white/10 rounded-lg px-3 text-[#F3F7FF] transition-all h-[38px] text-xs font-bold focus:border-emerald-500 focus:outline-none"
                >
                  {packageStatusList.map((status) => (
                    <option key={status} value={status} className="bg-slate-900 text-slate-200">
                      {status.replace("_", " ")}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {isAutoMapped && (
            <div className="bg-emerald-500/10 border border-emerald-500/20 p-6 rounded-xl flex flex-col md:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="bg-emerald-500/20 p-2 rounded-full text-emerald-500">
                  <CheckCircle2 size={24} />
                </div>
                <div>
                  <h4 className="text-emerald-400 font-bold">
                    ✓ File uploaded successfully
                  </h4>
                  <div className="flex gap-4 mt-1 text-sm text-slate-400">
                    <span>
                      Rows detected:{" "}
                      <strong className="text-slate-200">
                        {preview.row_count}
                      </strong>
                    </span>
                  </div>
                </div>
              </div>
              <button
                onClick={handlePredict}
                className="px-8 py-3 bg-emerald-500 text-white hover:bg-emerald-600 rounded-xl font-bold transition-all shadow-lg shadow-emerald-500/20 flex items-center gap-2"
              >
                Run Prediction <RefreshCw size={18} />
              </button>
            </div>
          )}

          {!isAutoMapped && (
            <div className="bg-surface rounded-xl border border-white/5 overflow-hidden">
              <div className="p-6 border-b border-white/5 bg-white/5">
                <h3 className="text-xl font-bold">Column Mapping Required</h3>
                <p className="text-sm text-slate-400 mt-1">
                  Some columns don't match the model schema. Please map them manually.
                </p>
              </div>
              <div className="p-6">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-12 gap-y-6">
                  {[...(preview.features || []), "Product_Type", "Package_Status"].map((feature) => {
                    const isMetadata = ["Product_Type", "Package_Status"].includes(feature);
                    return (
                      <div key={feature} className="flex flex-col gap-1.5">
                        <div className="flex justify-between items-center px-1">
                          <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                            {isMetadata ? "Metadata Field" : "Model Field"}
                          </span>
                          <span className="text-[11px] font-bold text-emerald-500 uppercase tracking-wider">
                            Uploaded Column
                          </span>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="flex-1 bg-slate-900/50 border border-white/5 rounded-lg px-3 py-2 text-sm text-slate-300 truncate">
                            {feature.replace(/_/g, " ")}
                          </div>
                          <div className="text-slate-600">→</div>
                          <select
                            className="flex-1 bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500 transition-colors"
                            value={mapping[feature] || ""}
                            onChange={(e) =>
                              setMapping({
                                ...mapping,
                                [feature]: e.target.value,
                              })
                            }
                          >
                            <option value="">Skip / None</option>
                            {preview.columns.map((col) => (
                              <option key={col} value={col}>
                                {col}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="mt-10 flex justify-center">
                  <button
                    onClick={handlePredict}
                    className="px-10 py-4 bg-emerald-500 text-white hover:bg-emerald-600 rounded-xl font-bold transition-all shadow-xl shadow-emerald-500/20 flex items-center gap-3 text-lg"
                  >
                    Confirm Mapping & Predict <RefreshCw size={22} />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {Array.isArray(results) && results.length > 0 && !loading && (
        <div className="space-y-6 animate-in zoom-in-95 duration-500">
          <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
            <div className="bg-surface p-4 rounded-xl border border-white/5 flex flex-col justify-between">
              <span className="text-xs text-slate-400 font-semibold uppercase">Total Batches</span>
              <span className="text-2xl font-bold text-white mt-1">{totalRows}</span>
            </div>
            <div className="bg-surface p-4 rounded-xl border border-emerald-500/20 bg-emerald-500/5 flex flex-col justify-between">
              <span className="text-xs text-emerald-400 font-semibold uppercase">Acceptable</span>
              <span className="text-2xl font-bold text-emerald-400 mt-1">{acceptableCount}</span>
            </div>
            <div className="bg-surface p-4 rounded-xl border border-red-500/20 bg-red-500/5 flex flex-col justify-between">
              <span className="text-xs text-red-400 font-semibold uppercase">Rejected</span>
              <span className="text-2xl font-bold text-red-400 mt-1">{rejectedCount}</span>
            </div>
            <div className="bg-surface p-4 rounded-xl border border-blue-500/20 bg-blue-500/5 flex flex-col justify-between">
              <span className="text-xs text-blue-400 font-semibold uppercase">Monitor Risk</span>
              <span className="text-2xl font-bold text-blue-400 mt-1">{monitorCount}</span>
            </div>
            <div className="bg-surface p-4 rounded-xl border border-orange-500/20 bg-orange-500/5 flex flex-col justify-between">
              <span className="text-xs text-orange-400 font-semibold uppercase">Near Spoilage</span>
              <span className="text-2xl font-bold text-orange-400 mt-1">{nearSpoilageCount}</span>
            </div>
            <div className="bg-surface p-4 rounded-xl border border-emerald-500/20 bg-emerald-500/5 flex flex-col justify-between col-span-2 md:col-span-1">
              <span className="text-xs text-emerald-400 font-semibold uppercase">Avg Shelf Life</span>
              <span className="text-2xl font-bold text-emerald-400 mt-1">{avgShelfLife} <span className="text-xs text-slate-400 font-normal">Days</span></span>
            </div>
          </div>

          <div className="bg-surface rounded-xl border border-white/5 overflow-hidden">
            <div className="p-6 border-b border-white/5 flex flex-col md:flex-row justify-between items-center bg-slate-900/50 gap-4">
              <div>
                <h3 className="text-xl font-bold">Batch Prediction & Health Results</h3>
                <p className="text-sm text-slate-400 mt-1">
                  Total {totalRows} rows processed and validated.
                </p>
              </div>
              <div className="flex flex-wrap gap-3 no-print">
                <button
                  onClick={handleExportPDF}
                  className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-white/10 rounded-xl font-semibold transition-all flex items-center gap-2 text-sm shadow-md"
                >
                  <Printer size={16} /> Export PDF Report
                </button>
                <button
                  onClick={handleDownload}
                  className="px-6 py-2.5 bg-emerald-500 text-white hover:bg-emerald-600 rounded-xl font-bold transition-all shadow-lg shadow-emerald-500/20 flex items-center gap-2 text-sm"
                >
                  <Download size={16} /> Download CSV
                </button>
              </div>
            </div>

            <div className="overflow-x-auto max-h-[600px]">
              <table className="w-full text-sm text-left relative">
                <thead className="text-xs text-slate-300 uppercase bg-slate-800 sticky top-0 z-10 shadow-md">
                  <tr>
                    <th className="px-6 py-4 font-semibold">#</th>
                    {results.length > 0 &&
                      Object.keys(results[0])
                        .filter((col) => !["Shelf_Life", "Predicted_Shelf_Life", "Risk_Level", "Product_Type", "Package_Status", "Oxidation_Rate", "Product_Status", "Software_Status", "Experimental_Status", "Rejection_Reason"].includes(col) && !col.startsWith("Estimated_"))
                        .slice(0, 5)
                        .map((col) => (
                          <th key={col} className="px-6 py-4 font-semibold">
                            {col.replace(/_/g, " ")}
                          </th>
                        ))}
                    <th className="px-6 py-4 font-semibold">Product Type</th>
                    <th className="px-6 py-4 font-semibold text-emerald-400">Predicted Shelf Life</th>
                    <th className="px-6 py-4 font-semibold">Experimental Status</th>
                    <th className="px-6 py-4 font-semibold">Software Status</th>
                    <th className="px-6 py-4 font-semibold">Rejection Reason(s)</th>
                    <th className="px-6 py-4 font-semibold">Risk Level</th>
                    <th className="px-6 py-4 font-semibold">Health & Quality Analysis</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedResults.map((row, idx) => {
                    const globalIdx = startIndex + idx + 1;
                    const inputCols = Object.keys(row).filter(
                      (col) => !["Shelf_Life", "Predicted_Shelf_Life", "Risk_Level", "Product_Type", "Package_Status", "Oxidation_Rate", "Product_Status", "Software_Status", "Experimental_Status", "Rejection_Reason"].includes(col) && !col.startsWith("Estimated_")
                    ).slice(0, 5);
                    const health = getHealthRecommendation(row?.Risk_Level);
                    const expStatus = row.Experimental_Status || row["Sample Status"] || row["Sample_Status"] || "Acceptable";
                    const softStatus = row.Software_Status || row.Product_Status || "ACCEPTABLE";

                    return (
                      <tr
                        key={globalIdx}
                        className="border-b border-white/5 hover:bg-white/5"
                      >
                        <td className="px-6 py-4 text-slate-500">{globalIdx}</td>
                        {inputCols.map((col) => (
                          <td key={col} className="px-6 py-4 font-medium text-slate-300">
                            {typeof row[col] === "number" ? row[col].toFixed(2) : String(row[col] ?? "N/A")}
                          </td>
                        ))}
                        <td className="px-6 py-4 text-slate-300 font-medium">{row.Product_Type || "N/A"}</td>
                        <td className="px-6 py-4 text-lg font-bold text-emerald-400">
                          {typeof row.Shelf_Life === "number" ? row.Shelf_Life.toFixed(1) : (row.Shelf_Life || "N/A")}{" "}
                          <span className="text-sm font-normal text-slate-400">
                            Days
                          </span>
                        </td>
                        <td className="px-6 py-4 text-slate-300 font-semibold">
                          {expStatus}
                        </td>
                        <td className="px-6 py-4">
                          {softStatus === "REJECTED" ? (
                            <span className="px-3 py-1 rounded-full text-xs font-bold bg-red-500/20 text-red-400 border border-red-500/30">
                              REJECTED
                            </span>
                          ) : (
                            <span className="px-3 py-1 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                              ACCEPTABLE
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-xs font-medium text-slate-300 max-w-xs">
                          {row.Rejection_Reason ? (
                            <span className="text-red-300 font-medium">{row.Rejection_Reason}</span>
                          ) : (
                            <span className="text-slate-500 italic">None</span>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          <span
                            className={`px-3 py-1 rounded-full text-xs font-bold border ${getRiskColor(row.Risk_Level)}`}
                          >
                            {row.Risk_Level}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-xs max-w-xs">
                          <p className="font-semibold text-slate-200">{health.rec}</p>
                          <p className="text-slate-400 text-[11px] mt-0.5">{health.analysis}</p>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="p-4 border-t border-white/5 bg-slate-900/40 flex flex-col md:flex-row justify-between items-center gap-4 text-sm text-slate-400 no-print">
              <div className="flex items-center gap-3">
                <span>Showing {startIndex + 1} to {Math.min(startIndex + effectivePageSize, totalRows)} of {totalRows} entries</span>
                <select
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="bg-slate-800 border border-white/10 text-slate-200 text-xs rounded-lg px-2 py-1 focus:outline-none focus:border-emerald-500"
                >
                  <option value={25}>25 per page</option>
                  <option value={50}>50 per page</option>
                  <option value={100}>100 per page</option>
                  <option value="all">Show All ({totalRows})</option>
                </select>
              </div>

              {pageSize !== "all" && totalPages > 1 && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    className="p-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg border border-white/5 transition-colors"
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <span className="text-xs font-semibold px-2">
                    Page {currentPage} of {totalPages}
                  </span>
                  <button
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                    className="p-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg border border-white/5 transition-colors"
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CsvPrediction;
