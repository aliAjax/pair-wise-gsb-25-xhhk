import type { FollowUpRecord } from "../types";
import { STATUS_LABEL } from "../domain/rules";

function fmt(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("zh-CN", { hour12: false });
}

/** 版本链弹窗：确认后的旧值仍能查询，包含每次变化原因与确认信息 */
export function VersionModal({
  record,
  onClose,
}: {
  record: FollowUpRecord;
  onClose: () => void;
}) {
  const versions = [...record.versions].reverse();
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">

          <div>
            <p className="eyebrow">版本链</p>
            <h2>
              {record.patientName} · {record.eye} · {record.examDate}
            </h2>
            {record.mrn && <p className="muted">病历号 {record.mrn}</p>}
          </div>
          <button type="button" className="ghost-btn" onClick={onClose}>
            关闭
          </button>
        </div>

        <ol className="version-timeline">
          {versions.map((v) => (
            <li
              key={v.version}
              className={`version-item status-${v.status}`}
            >
              <div className="version-top">
                <strong>v{v.version}</strong>
                <span className={`badge badge-${v.status}`}>
                  {STATUS_LABEL[v.status]}
                </span>
                {v.flagged && (
                  <span className="badge badge-danger-outline">
                    转专科 {v.flagged ? "✓" : ""}
                  </span>
                )}
                {v.specialist && <span className="badge tag">专科确认</span>}
              </div>
              <div className="version-grid">
                <span>
                  最薄点
                  <b className={v.flagged ? "danger-text" : ""}>
                    {v.thinnest} μm
                  </b>
                </span>
                <span>
                  Kmax<b>{v.kmax} D</b>
                </span>
                <span>
                  半年变化
                  <b className={v.flagged ? "danger-text" : ""}>
                    {v.change6m} μm
                  </b>
                </span>
                <span>
                  治疗阶段
                  <b>{v.stage}</b>
                </span>
              </div>
              {v.flagReasons.length > 0 && (
                <p className="flag-line">触发原因：{v.flagReasons.join("；")}</p>
              )}
              {v.reason && <p className="reason-line">变化原因：{v.reason}</p>}
              <p className="muted small">
                录入 {fmt(v.createdAt)}
                {v.confirmedAt ? ` · 确认 ${fmt(v.confirmedAt)} · ${v.confirmedBy}` : ""}
              </p>
            </li>
          ))}
        </ol>

        {record.schedules.length > 0 && (
          <div className="modal-schedules">
            <h3>关联排程（跟随确认版本，已锁定）</h3>
            {record.schedules.map((s) => (
              <p key={s.id} className="small">
                {s.slotDate} {s.slot} · 基于 v{s.versionId} · 排程人{" "}
                {s.createdBy}
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
