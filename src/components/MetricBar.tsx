import type { Summary } from "../types";

interface MetricDef {
  key: string;
  label: string;
  value: number;
  hint: string;
  tone: "blue" | "amber" | "red" | "green" | "violet";
}

interface Props {
  summary: Summary;
  onSelect: (key: string) => void;
  active: string;
}

/** 顶部指标：随记录状态实时刷新；点击卡片可联动下方列表/切到排程 */
export function MetricBar({ summary, onSelect, active }: Props) {
  const metrics: MetricDef[] = [
    {
      key: "all",
      label: "随访记录总数",
      value: summary.total,
      hint: "同一患者同一天同眼仅一条",
      tone: "blue",
    },
    {
      key: "pending",
      label: "待确认",
      value: summary.pending,
      hint: "普通录入，等待医师确认锁定",
      tone: "amber",
    },
    {
      key: "specialist",
      label: "转专科待确认",
      value: summary.specialist,
      hint: "最薄点<400μm 或 半年变化>25μm",
      tone: "red",
    },
    {
      key: "confirmed",
      label: "已确认锁定",
      value: summary.confirmed,
      hint: "检查锁定；改参数将生成新版本",
      tone: "green",
    },
    {
      key: "scheduled",
      label: "已排交联设备",
      value: summary.scheduled,
      hint: `今日 ${summary.scheduledToday} 人 · 同时段仅一人`,
      tone: "violet",
    },
  ];

  return (
    <section className="metrics-grid">
      {metrics.map((m) => (
        <button
          key={m.key}
          type="button"
          className={`metric-card metric-${m.tone} ${
            active === m.key ? "metric-active" : ""
          }`}
          onClick={() => onSelect(m.key)}
        >
          <span>{m.label}</span>
          <strong>{m.value}</strong>
          <em>{m.hint}</em>
        </button>
      ))}
    </section>
  );
}
