import React, { useState, useEffect } from "react";
import axios from "axios";
import {
  Activity,
  ShieldCheck,
  AlertTriangle,
  XOctagon,
  RotateCcw,
  FlaskConical,
  Zap,
  Play,
  Info,
  CheckCircle2,
} from "lucide-react";

const API = import.meta.env.VITE_API_URL ?? "";

const ManualPrediction = () => {
  const [formData, setFormData] = useState({
    Retort_Temperature: "",
    Holding_Time: "",
    F0: "",
    Storage_Temperature: "",
    Storage_Day: "",
    pH: "",
    PV: "",
    TPC: "",
    O2: "",
    CO2: "",
    Moisture_Content: "",
    L_Value: "",
    a_Value: "",
    b_Value: "",
    Overall_Acceptability: "",
  });

  const [loading, setLoading] = useState(false);
  const [estimating, setEstimating] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [isGenerated, setIsGenerated] = useState(false);
  const [generatedFields, setGeneratedFields] = useState([]);
  const [hoveredField, setHoveredField] = useState(null);
  const [productType, setProductType] = useState("retorted");
  const [packageStatus, setPackageStatus] = useState("Normal");
  const [thresholds, setThresholds] = useState(null);

  useEffect(() => {
    axios
      .get(`${API}/thresholds`)
      .then((res) => {
        setThresholds(res.data);
      })
      .catch((err) => {
        console.error("Failed to load thresholds config, using static defaults.", err);
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

  const isFieldDisabled = (fieldName) => {
    return productType === "unretorted" && ["Retort_Temperature", "Holding_Time", "F0"].includes(fieldName);
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    setGeneratedFields((prev) => prev.filter((f) => f !== name));
    setResult(null);
  };

  const handleReset = () => {
    setFormData({
      Retort_Temperature: "",
      Holding_Time: "",
      F0: "",
      Storage_Temperature: "",
      Storage_Day: "",
      pH: "",
      PV: "",
      TPC: "",
      O2: "",
      CO2: "",
      Moisture_Content: "",
      L_Value: "",
      a_Value: "",
      b_Value: "",
      Overall_Acceptability: "",
    });
    setResult(null);
    setError(null);
    setIsGenerated(false);
    setGeneratedFields([]);
    setProductType("retorted");
    setPackageStatus("Normal");
  };

  const loadSample = () => {
    setFormData({
      Retort_Temperature: "121",
      Holding_Time: "20",
      F0: "25",
      Storage_Temperature: "25",
      Storage_Day: "0",
      pH: "6.5",
      PV: "0.5",
      TPC: "0.2",
      O2: "18",
      CO2: "1",
      Moisture_Content: "40",
      L_Value: "60",
      a_Value: "5",
      b_Value: "15",
      Overall_Acceptability: "8",
    });
    setProductType("retorted");
    setPackageStatus("Normal");
    setGeneratedFields([]);
    setIsGenerated(true);
    setResult(null);
  };

  const handleEstimate = async () => {
    setEstimating(true);
    setError(null);

    const filledCount = Object.keys(formData).filter(
      (key) => formData[key] !== "" && !isFieldDisabled(key),
    ).length;
    if (filledCount < 1) {
      setError(
        "Please enter at least one condition to generate expected quality.",
      );
      setEstimating(false);
      return;
    }

    const payload = {
      Product_Type: productType,
      Package_Status: packageStatus,
    };
    Object.keys(formData).forEach((key) => {
      if (formData[key] !== "" && !isFieldDisabled(key)) {
        payload[key] = parseFloat(formData[key]);
      }
    });

    try {
      const res = await axios.post(
        `${API}/estimate-quality`,
        payload,
      );
      const updatedData = { ...formData };
      const newlyGenerated = [];
      Object.keys(res.data).forEach((key) => {
        // Only fill if not disabled
        if (isFieldDisabled(key)) return;

        if (!formData[key] || formData[key] === "") {
          newlyGenerated.push(key);
        }
        const val = res.data[key];
        updatedData[key] = typeof val === "number" ? val.toFixed(2) : val;
      });
      setFormData(updatedData);
      setGeneratedFields(newlyGenerated);
      setIsGenerated(true);
      setResult(null);
    } catch (err) {
      setError(err.response?.data?.detail || "Estimation failed.");
    } finally {
      setEstimating(false);
    }
  };

  const handlePredict = async () => {
    setLoading(true);
    setError(null);

    const filledCount = Object.keys(formData).filter(
      (key) => formData[key] !== "" && !isFieldDisabled(key),
    ).length;
    if (filledCount < 1) {
      setError(
        "Please enter at least one condition to predict expected shelf life.",
      );
      setLoading(false);
      return;
    }

    const payload = {
      Product_Type: productType,
      Package_Status: packageStatus,
    };
    Object.keys(formData).forEach((key) => {
      if (formData[key] !== "" && !isFieldDisabled(key)) {
        payload[key] = parseFloat(formData[key]);
      }
    });

    try {
      const res = await axios.post(
        `${API}/manual-predict`,
        payload,
      );
      setResult(res.data);
    } catch (err) {
      setError(err.response?.data?.detail || "Prediction failed.");
    } finally {
      setLoading(false);
    }
  };

  const getRiskUI = (level) => {
    switch (level) {
      case "Fresh":
        return {
          color: "text-green-500",
          bg: "bg-green-500/10",
          border: "border-green-500/20",
          fullBg: "bg-green-500",
          icon: <ShieldCheck size={32} />,
          recommendation: "Safe for storage and distribution.",
          reason:
            "Low microbial activity and good quality indicators detected.",
        };
      case "Monitor":
        return {
          color: "text-yellow-500",
          bg: "bg-yellow-500/10",
          border: "border-yellow-500/20",
          fullBg: "bg-yellow-500",
          icon: <Activity size={32} />,
          recommendation: "Monitor quality parameters periodically.",
          reason: "Some deterioration indicators are increasing.",
        };
      case "Near Spoilage":
        return {
          color: "text-orange-500",
          bg: "bg-orange-500/10",
          border: "border-orange-500/20",
          fullBg: "bg-orange-500",
          icon: <AlertTriangle size={32} />,
          recommendation: "Consume soon or perform quality inspection.",
          reason: "Quality degradation indicators are becoming significant.",
        };
      case "Spoiled":
        return {
          color: "text-red-500",
          bg: "bg-red-500/10",
          border: "border-red-500/20",
          fullBg: "bg-red-500",
          icon: <XOctagon size={32} />,
          recommendation: "Immediate inspection or disposal recommended.",
          reason: "Multiple spoilage indicators exceed acceptable limits.",
        };
      default:
        return {
          color: "text-slate-500",
          bg: "bg-slate-500/10",
          border: "border-slate-500/20",
          fullBg: "bg-slate-500",
          icon: <Activity size={32} />,
          recommendation: "N/A",
          reason: "N/A",
        };
    }
  };

  const fields = [
    {
      name: "Retort_Temperature",
      label: "Retort Temperature (°C)",
      tooltip: "The temperature at which the food was processed.",
    },
    {
      name: "Holding_Time",
      label: "Holding Time (mins)",
      tooltip: "Duration for which the retort temperature was maintained.",
    },
    {
      name: "F0",
      label: "F0 Value",
      tooltip: "Measures sterilization effectiveness.",
    },
    {
      name: "Storage_Temperature",
      label: "Storage Temp (°C)",
      tooltip: "The temperature at which the food is stored.",
    },
    {
      name: "Storage_Day",
      label: "Storage Day",
      tooltip: "The number of days the food has been in storage.",
    },
    {
      name: "pH",
      label: "pH Level",
      tooltip: "The acidity or alkalinity of the food.",
    },
    {
      name: "PV",
      label: "Peroxide Value (PV)",
      tooltip: "Measures oil rancidity.",
    },
    {
      name: "TPC",
      label: "Total Plate Count (TPC)",
      tooltip: "Measures microbial count.",
    },
    {
      name: "O2",
      label: "Oxygen (O2) %",
      tooltip: "Oxygen concentration in the packaging.",
    },
    {
      name: "CO2",
      label: "Carbon Dioxide (CO2) %",
      tooltip: "CO2 concentration in the packaging.",
    },
    {
      name: "Moisture_Content",
      label: "Moisture Content %",
      tooltip: "Percentage of water in the food.",
    },
    {
      name: "L_Value",
      label: "L* Value",
      tooltip: "Measures lightness of food.",
    },
    {
      name: "a_Value",
      label: "a* Value",
      tooltip: "Measures red-green color scale.",
    },
    {
      name: "b_Value",
      label: "b* Value",
      tooltip: "Measures yellow-blue color scale.",
    },
    {
      name: "Overall_Acceptability",
      label: "Overall Acceptability (1-9)",
      tooltip: "Sensory acceptability score. Score below 5 indicates rejection.",
    },
  ];

  const filledFieldsCount = Object.keys(formData).filter(
    (key) => formData[key] !== "",
  ).length;
  const userEnteredCount = Object.keys(formData).filter(
    (key) => formData[key] !== "" && !generatedFields.includes(key),
  ).length;

  const confidence =
    userEnteredCount <= 1 ? "Low" : userEnteredCount <= 4 ? "Medium" : "High";

  return (
    <div className="max-w-7xl mx-auto space-y-8 animate-in fade-in duration-500 p-6 font-poppins selection:bg-primary/30 antialiased">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h2 className="text-[20px] font-bold tracking-tight text-white/95">
            Manual Prediction
          </h2>
          <p className="text-slate-300 mt-1 text-[14px] font-medium opacity-90">
            Professional quality forecasting with two-stage AI validation.
          </p>
        </div>
        <div className="flex items-center gap-2 px-4 py-2 bg-white/10 rounded-xl border border-white/20 text-[11px] font-bold text-slate-200 shadow-sm">
          <Activity size={12} className="text-primary" />
          SYSTEM STATUS:{" "}
          <span className="text-primary-foreground bg-primary px-1.5 py-0.5 rounded-[4px]">
            READY
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-10 gap-6 items-start">
        <div className="xl:col-span-7 bg-surface/40 backdrop-blur-sm p-8 rounded-[1.5rem] border border-white/10 shadow-xl relative">
          
          {/* Product Type Toggle & Package Status Dropdown */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8 bg-white/[0.02] p-5 rounded-2xl border border-white/5">
            <div className="space-y-2">
              <label className="text-[12px] font-bold text-[rgba(220,230,245,0.85)] uppercase tracking-[0.5px]">Product Type</label>
              <div className="flex gap-2">
                {productTypesList.map((typeObj) => {
                  const active = productType === typeObj.key;
                  return (
                    <button
                      key={typeObj.key}
                      type="button"
                      onClick={() => {
                        setProductType(typeObj.key);
                        setResult(null);
                      }}
                      className={`flex-1 h-[40px] rounded-xl font-bold text-xs uppercase tracking-wider border transition-all ${
                        active
                          ? "bg-primary text-white border-primary shadow-md shadow-primary/20"
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
              <label className="text-[12px] font-bold text-[rgba(220,230,245,0.85)] uppercase tracking-[0.5px]">Package Status</label>
              <select
                value={packageStatus}
                onChange={(e) => {
                  setPackageStatus(e.target.value);
                  setResult(null);
                }}
                className="w-full bg-slate-950/40 border border-white/10 rounded-[12px] px-3 text-[#F3F7FF] transition-all duration-150 h-[40px] text-xs font-bold focus:border-primary focus:ring-4 focus:ring-primary/10"
              >
                {packageStatusList.map((status) => (
                  <option key={status} value={status} className="bg-slate-900 text-slate-200">
                    {status.replace("_", " ")}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-y-8 gap-x-6">
            {fields.map((field) => {
              const disabled = isFieldDisabled(field.name);
              return (
                <div
                  key={field.name}
                  className="space-y-2.5 relative group"
                  onMouseEnter={() => setHoveredField(field.name)}
                  onMouseLeave={() => setHoveredField(null)}
                >
                  <div className="flex items-center justify-between px-1">
                    <label className="text-[12px] font-medium text-[rgba(220,230,245,0.85)] uppercase tracking-[0.3px] flex items-center gap-1.5 block">
                      <span>{field.label.split("(")[0]}</span>
                      <span className="text-[11px] lowercase opacity-60 italic font-normal">
                        {field.label.includes("(")
                          ? `(${field.label.split("(")[1]}`
                          : ""}
                      </span>
                    </label>
                    {generatedFields.includes(field.name) && !disabled && (
                      <div className="flex items-center gap-1 text-[9px] font-bold uppercase text-white bg-blue-600 px-2 py-1 rounded-full border border-blue-400/30 animate-in zoom-in-95 shadow-sm whitespace-nowrap leading-none">
                        <Zap size={10} fill="white" className="shrink-0" />
                        Expected
                      </div>
                    )}
                  </div>

                  <div className="relative">
                    <input
                      type="number"
                      step="any"
                      name={field.name}
                      value={formData[field.name]}
                      disabled={disabled}
                      onChange={handleChange}
                      className={`w-full bg-slate-950/40 border rounded-[12px] px-3 text-[#F3F7FF] transition-all duration-150 h-[48px] text-[15px] font-semibold shadow-inner ${
                        disabled
                          ? "opacity-50 cursor-not-allowed bg-slate-900/60 border-dashed border-white/5 text-slate-500"
                          : generatedFields.includes(field.name)
                            ? "border-blue-500/50 bg-blue-500/[0.05] focus:border-blue-400 focus:ring-4 focus:ring-blue-500/10 text-blue-50"
                            : "border-white/10 focus:border-primary focus:ring-4 focus:ring-primary/10"
                      }`}
                      placeholder={disabled ? "N/A" : ""}
                    />
                    {disabled && (
                      <p className="text-[10px] text-amber-400/80 font-medium mt-1">
                        Not applicable for Unretorted products.
                      </p>
                    )}

                    {/* Floating Tooltip */}
                    {hoveredField === field.name && (
                      <div className="absolute -top-12 left-0 z-50 bg-slate-800 text-white text-[10px] px-3 py-2 rounded-lg border border-white/10 shadow-xl pointer-events-none animate-in fade-in zoom-in-95 duration-200 flex items-center gap-2 whitespace-nowrap">
                        <Info size={12} className="text-primary" />
                        {field.tooltip}
                        <div className="absolute -bottom-1 left-4 w-2 h-2 bg-slate-800 border-r border-b border-white/10 rotate-45" />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-3 mt-12 border-t border-white/10 pt-8">
            {!isGenerated ? (
              <button
                onClick={handleEstimate}
                disabled={estimating || filledFieldsCount < 1}
                className="h-[44px] bg-primary text-white border-none rounded-[12px] font-semibold uppercase tracking-wider hover:bg-primary/90 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-2 px-6 text-[13px] disabled:opacity-50 min-w-[170px] shadow-lg shadow-primary/20"
              >
                {estimating ? (
                  <Activity className="animate-spin" size={16} />
                ) : (
                  <Zap size={16} />
                )}
                Generate Expected Quality
              </button>
            ) : (
              <button
                onClick={handleEstimate}
                disabled={estimating || filledFieldsCount < 1}
                className="h-[44px] bg-white/5 text-slate-200 border border-white/20 rounded-[12px] font-semibold uppercase tracking-wider hover:bg-white/10 transition-all flex items-center justify-center gap-2 px-6 text-[13px] min-w-[170px]"
              >
                {estimating ? (
                  <Activity className="animate-spin" size={16} />
                ) : (
                  <RotateCcw size={16} />
                )}
                Regenerate
              </button>
            )}

            {isGenerated && filledFieldsCount >= 1 && (
              <button
                onClick={handlePredict}
                disabled={loading}
                className="h-[44px] bg-emerald-500 text-white border-none rounded-[12px] font-semibold uppercase tracking-wider hover:bg-emerald-400 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-2 px-6 text-[13px] shadow-lg shadow-emerald-500/20 animate-in zoom-in-95 min-w-[170px]"
              >
                {loading ? (
                  <Activity className="animate-spin" size={16} />
                ) : (
                  <Play size={16} />
                )}
                Predict Expected Shelf Life
              </button>
            )}

            {filledFieldsCount < 1 && (
              <div className="text-[12px] font-medium text-amber-400 bg-amber-500/10 px-4 py-2.5 rounded-xl border border-amber-500/20 flex items-center gap-2">
                <Info size={14} />
                Enter at least one condition.
              </div>
            )}

            {isGenerated && filledFieldsCount >= 1 && (
              <div className="text-[12px] font-medium text-emerald-400 bg-emerald-500/10 px-4 py-2.5 rounded-xl border border-emerald-500/20 flex items-center gap-2">
                <CheckCircle2 size={14} className="text-emerald-400" />
                Expected values generated from available inputs. Review before
                prediction.
              </div>
            )}

            <button
              onClick={loadSample}
              className="h-[44px] bg-slate-800 text-white rounded-[12px] font-semibold uppercase tracking-wider hover:bg-slate-700 transition-all flex items-center justify-center gap-2 px-6 text-[13px] min-w-[160px] border border-white/5"
            >
              <FlaskConical size={16} />
              Sample Data
            </button>

            <button
              onClick={handleReset}
              className="h-[44px] bg-red-500/10 text-red-400 border border-red-500/30 rounded-[12px] font-semibold uppercase tracking-wider hover:bg-red-500/20 hover:text-red-300 transition-all flex items-center justify-center gap-2 px-6 text-[13px] min-w-[160px]"
            >
              <RotateCcw size={16} />
              Reset Form
            </button>
          </div>
        </div>

        <div className="xl:col-span-3">
          <div className="sticky top-8 space-y-5 flex flex-col items-center">
            {error && (
              <div className="w-full bg-red-500/20 border border-red-500/30 text-red-100 p-6 rounded-[1.2rem] text-sm animate-in slide-in-from-top-4 flex items-start gap-4 shadow-xl">
                <AlertTriangle size={20} className="shrink-0 text-red-400" />
                <div className="space-y-1">
                  <p className="font-bold uppercase tracking-widest text-[10px] text-red-300">
                    Processing Error
                  </p>
                  <p className="font-medium leading-relaxed">{error}</p>
                </div>
              </div>
            )}

            {result && filledFieldsCount >= 1 ? (
              <div
                className={`w-full p-6 rounded-[1.2rem] border border-white/20 flex flex-col space-y-6 animate-in zoom-in-95 duration-500 shadow-2xl relative overflow-hidden bg-surface/60 backdrop-blur-md`}
              >
                <div className="flex items-center justify-between relative z-10">
                  <div
                    className={`${getRiskUI(result.risk_level).color} bg-white/10 p-2.5 rounded-xl border border-white/10`}
                  >
                    {result.risk_level === "Fresh" ? (
                      <ShieldCheck size={20} />
                    ) : (
                      <Activity size={20} />
                    )}
                  </div>
                  <div
                    className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-[1px] ${getRiskUI(result.risk_level).fullBg} text-white shadow-lg border border-white/20`}
                  >
                    {result.risk_level}
                  </div>
                </div>

                <div className="relative z-10">
                  <p className="text-slate-300 text-[12px] font-semibold uppercase tracking-[0.5px] opacity-90">
                    Predicted Remaining Shelf Life
                  </p>
                  <div className="flex items-baseline gap-2 mt-1">
                    <h3 className="text-[46px] leading-none font-bold text-white tracking-tighter drop-shadow-md">
                      {result.shelf_life}
                    </h3>
                    <span className="text-slate-200 font-bold text-lg uppercase tracking-tight">
                      Days
                    </span>
                  </div>
                </div>

                {/* Product Acceptance Status Card */}
                <div className="relative z-10 space-y-3 pt-4 border-t border-white/10">
                  <p className="text-slate-300 text-[11px] font-bold uppercase tracking-[0.5px]">
                    Product Status
                  </p>
                  <div className="flex items-center gap-3">
                    {result.product_status === "REJECTED" ? (
                      <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-red-500/20 border border-red-500/40 text-red-400 font-bold text-sm uppercase tracking-wider shadow-lg shadow-red-500/10">
                        <XOctagon size={18} className="text-red-400" />
                        REJECTED
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 font-bold text-sm uppercase tracking-wider shadow-lg shadow-emerald-500/10">
                        <CheckCircle2 size={18} className="text-emerald-400" />
                        ACCEPTABLE
                      </div>
                    )}
                  </div>

                  {result.product_status === "REJECTED" && result.rejection_reasons?.length > 0 && (
                    <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3.5 space-y-2 mt-2">
                      <p className="text-red-300 font-bold text-[11px] uppercase tracking-wider flex items-center gap-1.5">
                        <AlertTriangle size={14} className="text-red-400 shrink-0" />
                        Rejection Reason(s)
                      </p>
                      <ul className="space-y-1 text-red-200 text-xs font-semibold">
                        {result.rejection_reasons.map((reason, rIdx) => (
                          <li key={rIdx} className="flex items-start gap-1.5">
                            <span className="text-red-400 font-bold">•</span>
                            <span>{reason}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>

                <div className="pt-6 border-t border-white/20 space-y-4 relative z-10">
                  <div className="flex items-start gap-4">
                    <div className="bg-primary/20 p-1.5 rounded-lg border border-primary/20 mt-0.5">
                      <ShieldCheck size={18} className="text-primary" />
                    </div>
                    <div className="space-y-1">
                      <p className="text-white text-[12px] font-bold uppercase tracking-[0.5px]">
                        Recommendation
                      </p>
                      <p className="text-slate-100 text-[15px] leading-[1.6] font-semibold">
                        {getRiskUI(result.risk_level).recommendation}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-4 pt-2">
                    <div className="bg-slate-800/50 p-1.5 rounded-lg border border-white/10 mt-0.5">
                      <Activity size={16} className="text-slate-300" />
                    </div>
                    <div className="space-y-1">
                      <p className="text-slate-100 text-[11px] font-bold uppercase tracking-[0.5px] opacity-70">
                        Prediction Confidence
                      </p>
                      <p
                        className={`text-[15px] font-bold ${
                          confidence === "High"
                            ? "text-emerald-400"
                            : confidence === "Medium"
                              ? "text-yellow-400"
                              : "text-orange-400"
                        }`}
                      >
                        {confidence} Confidence
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-4 pt-2">
                    <div className="bg-slate-800/50 p-1.5 rounded-lg border border-white/10 mt-0.5">
                      <Info size={16} className="text-slate-300" />
                    </div>
                    <div className="space-y-1">
                      <p className="text-slate-100 text-[11px] font-bold uppercase tracking-[0.5px] opacity-70">
                        Analysis
                      </p>
                      <p className="text-slate-300 text-[13px] italic leading-relaxed font-medium opacity-80">
                        {getRiskUI(result.risk_level).reason}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="text-center pt-2">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest opacity-50">
                    Validated by FoodAI-Stage2
                  </p>
                </div>
              </div>
            ) : (
              <div className="w-full flex-1 min-h-[400px] border border-white/5 rounded-[1.2rem] flex flex-col items-center justify-center text-center p-10 text-slate-500 bg-surface/20 transition-all">
                <div className="bg-white/5 p-8 rounded-full mb-6 relative">
                  <Activity size={32} className="text-slate-700 opacity-20" />
                  <Activity
                    size={16}
                    className="absolute bottom-4 right-4 text-primary/20 animate-pulse"
                  />
                </div>
                <h4 className="text-white/80 font-semibold uppercase tracking-[2px] text-xs mb-3 opacity-60">
                  Waiting for values
                </h4>
                <p className="text-[12px] leading-relaxed font-medium max-w-[180px] mx-auto opacity-30">
                  Complete Step 1 to initialize quality analysis.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ManualPrediction;
