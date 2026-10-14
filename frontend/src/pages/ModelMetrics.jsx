import { useEffect, useState } from "react";
import axios from "axios";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  AreaChart,
  Area,
} from "recharts";
import { Target, Activity, TrendingUp, AlertCircle } from "lucide-react";
import { Link } from "react-router-dom";

const ModelMetrics = () => {
  const [metrics, setMetrics] = useState(null);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const API = import.meta.env.VITE_API_URL ?? "";
        const [metricsRes, logsRes] = await Promise.all([
          axios.get(`${API}/metrics`),
          axios.get(`${API}/logs`),
        ]);
        setMetrics(metricsRes.data);
        setLogs(logsRes.data);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64 text-slate-400">
        Loading metrics...
      </div>
    );
  }

  if (!metrics || metrics.mae === null) {
    return (
      <div className="flex flex-col justify-center items-center h-64 text-slate-400 space-y-4">
        <AlertCircle size={48} className="text-slate-500" />
        <p>No metrics available. Please train the model first.</p>
        <Link to="/" className="text-primary hover:underline">
          Back to Home
        </Link>
      </div>
    );
  }

  const featureData = Object.entries(metrics.feature_importances)
    .map(([name, value]) => ({
      name: name.replace(/_/g, " "),
      importance: value,
    }))
    .sort((a, b) => b.importance - a.importance)
    .slice(0, 10); // Top 10

  const distributionData = logs.map((log, idx) => ({
    id: idx,
    predicted: log.shelf_life_remaining ?? log.predicted_shelf_life,
  }));

  return (
    <div className="space-y-8 animate-in fade-in duration-500 max-w-6xl mx-auto py-4">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-3xl font-bold">Model Metrics</h2>
          <p className="text-slate-400 mt-2">
            Evaluation metrics for the ShelfLife AI Regressor
          </p>
        </div>
        <Link
          to="/"
          className="px-4 py-2 bg-surface text-white border border-white/10 hover:bg-white/5 rounded-xl transition-all font-medium"
        >
          Back to Home
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-surface/50 p-6 rounded-xl border border-white/5 flex items-center gap-4 hover:border-blue-500/30 transition-colors">
          <div className="bg-blue-500/20 p-4 rounded-full text-blue-400">
            <Target size={28} />
          </div>
          <div>
            <p className="text-slate-400 text-sm">R² Score</p>
            <h3 className="text-2xl font-bold">
              {(metrics.r2_score * 100).toFixed(2)}%
            </h3>
          </div>
        </div>

        <div className="bg-surface/50 p-6 rounded-xl border border-white/5 flex items-center gap-4 hover:border-emerald-500/30 transition-colors">
          <div className="bg-emerald-500/20 p-4 rounded-full text-emerald-400">
            <TrendingUp size={28} />
          </div>
          <div>
            <p className="text-slate-400 text-sm">Mean Absolute Error (MAE)</p>
            <h3 className="text-2xl font-bold">{metrics.mae.toFixed(2)}</h3>
          </div>
        </div>

        <div className="bg-surface/50 p-6 rounded-xl border border-white/5 flex items-center gap-4 hover:border-orange-500/30 transition-colors">
          <div className="bg-orange-500/20 p-4 rounded-full text-orange-400">
            <Activity size={28} />
          </div>
          <div>
            <p className="text-slate-400 text-sm">
              Root Mean Squared Error (RMSE)
            </p>
            <h3 className="text-2xl font-bold">{metrics.rmse.toFixed(2)}</h3>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="bg-surface rounded-xl border border-white/5 p-6">
          <h3 className="text-xl font-semibold mb-6">
            Feature Importance (Top 10)
          </h3>
          <div className="h-[350px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={featureData}
                layout="vertical"
                margin={{ top: 5, right: 30, left: 100, bottom: 5 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="#334155"
                  horizontal={true}
                  vertical={false}
                />
                <XAxis type="number" stroke="#94a3b8" />
                <YAxis
                  dataKey="name"
                  type="category"
                  stroke="#94a3b8"
                  width={110}
                  tick={{ fontSize: 12 }}
                />
                <Tooltip
                  cursor={{ fill: "#334155", opacity: 0.4 }}
                  contentStyle={{
                    backgroundColor: "#1e293b",
                    borderColor: "#334155",
                    borderRadius: "8px",
                  }}
                />
                <Bar
                  dataKey="importance"
                  fill="#3b82f6"
                  radius={[0, 4, 4, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-surface rounded-xl border border-white/5 p-6">
          <h3 className="text-xl font-semibold mb-6">
            Prediction Distribution
          </h3>
          {distributionData.length > 0 ? (
            <div className="h-[350px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={distributionData}
                  margin={{ top: 10, right: 30, left: 0, bottom: 0 }}
                >
                  <defs>
                    <linearGradient id="colorPv" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.8} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="id" stroke="#94a3b8" hide />
                  <YAxis stroke="#94a3b8" />
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="#334155"
                    vertical={false}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#1e293b",
                      borderColor: "#334155",
                      borderRadius: "8px",
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="predicted"
                    stroke="#10b981"
                    fillOpacity={1}
                    fill="url(#colorPv)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-[350px] flex items-center justify-center text-slate-500">
              No prediction logs available to chart.
            </div>
          )}
        </div>
      </div>

      <div className="text-sm text-slate-500 text-right">
        Last model update: {new Date(metrics.timestamp).toLocaleString()}
      </div>
    </div>
  );
};

export default ModelMetrics;
