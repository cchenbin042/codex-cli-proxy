// src/components/dashboard/Charts.tsx
import { useHourlyTrend, useProviderDistribution } from "../../hooks/useStats";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";

const COLORS = ["#6c8cff", "#34d399", "#f59e0b", "#f87171", "#a78bfa", "#38bdf8"];

export function RequestTrendChart() {
  const trend = useHourlyTrend();

  return (
    <div className="card p-5">
      <h3 className="section-header">请求趋势 (24h)</h3>
      {trend.length === 0 ? (
        <div className="h-[180px] flex items-center justify-center text-text-dim text-sm">
          暂无数据
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={trend}>
            <XAxis
              dataKey="hour"
              stroke="#6b6b7b"
              fontSize={11}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              stroke="#6b6b7b"
              fontSize={11}
              allowDecimals={false}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              contentStyle={{
                background: "#181820",
                border: "1px solid #252530",
                borderRadius: 8,
                fontSize: 12,
              }}
              labelStyle={{ color: "#a0a0b0" }}
              cursor={{ fill: "rgba(108,140,255,0.06)" }}
            />
            <Bar dataKey="count" fill="#6c8cff" radius={[4, 4, 0, 0]} maxBarSize={32} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

export function ProviderUsageChart() {
  const dist = useProviderDistribution().map((d) => ({
    name: d.provider_id,
    value: d.count,
  }));

  const total = dist.reduce((sum, d) => sum + d.value, 0);

  return (
    <div className="card p-5">
      <h3 className="section-header">供应商分布</h3>
      {dist.length === 0 || total === 0 ? (
        <div className="h-[180px] flex items-center justify-center text-text-dim text-sm">
          暂无数据
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={180}>
          <PieChart>
            <Pie
              data={dist}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              outerRadius={70}
              innerRadius={30}
              paddingAngle={3}
            >
              {dist.map((_, i) => (
                <Cell key={i} fill={COLORS[i % COLORS.length]} stroke="none" />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                background: "#181820",
                border: "1px solid #252530",
                borderRadius: 8,
                fontSize: 12,
              }}
            />
          </PieChart>
        </ResponsiveContainer>
      )}
      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-3 justify-center">
        {dist.map((d, i) => (
          <div key={d.name} className="flex items-center gap-1.5 text-[0.7rem] text-text-secondary">
            <span
              className="w-2.5 h-2.5 rounded-full"
              style={{ background: COLORS[i % COLORS.length] }}
            />
            {d.name}
          </div>
        ))}
      </div>
    </div>
  );
}
