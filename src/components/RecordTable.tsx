import { useState } from "react";
import type { FollowUpRecord } from "../types";
import type { Store } from "../data/useStore";
import { VersionModal } from "./VersionModal";
import {
  STATUS_LABEL,
  canSchedule,
  hasSchedule,
  isLocked,
  latestVersion,
} from "../domain/rules";

interface Props {
  records: FollowUpRecord[];
  store: Store;
  operator: string;
  isSpecialist: boolean;
  onToast: (msg: string, kind?: "ok" | "err") => void;
  onGoSchedule: (recordId: string) => void;
}

/** 随访记录列表：确认 / 删除入口、版本链查看、排程联动 */
export function RecordTable({
  records,
  store,
  operator,
  isSpecialist,
  onToast,
  onGoSchedule,
}: Props) {
  const [openId, setOpenId] = useState<string | null>(null);
  const openRecord = records.find((r) => r.id === openId)
    ?? store.records.find((r) => r.id === openId)
    ?? null;

  function handleConfirm(r: FollowUpRecord) {
    try {
      store.confirm(r.id, operator, isSpecialist);
      const v = latestVersion(r);
      onToast(
        v.flagged
          ? "专科确认完成：检查已锁定，但仍不能占用交联设备"
          : "检查已确认锁定",
        "ok"
      );
    } catch (e) {
      onToast(e instanceof Error ? e.message : "确认失败", "err");
    }
  }

  function handleDelete(r: FollowUpRecord) {
    try {
      store.remove(r.id);
      onToast("记录已删除", "ok");
    } catch (e) {
      onToast(e instanceof Error ? e.message : "删除失败", "err");
    }
  }

  return (
    <section className="panel table-panel">
      <div className="section-heading">
        <div>
          <p>随访记录</p>
          <h2>
            记录列表 <span className="count-tag">{records.length}</span>
          </h2>
        </div>
      </div>

      {records.length === 0 ? (
        <div className="empty-state">
          当前筛选下没有记录。可在上方录入，或重置筛选条件。
        </div>
      ) : (
        <div className="table-wrap">
          <table className="record-table">
            <thead>
              <tr>
                <th>患者 / 眼别</th>
                <th>检查日期</th>
                <th>最薄点(μm)</th>
                <th>Kmax(D)</th>
                <th>半年变化(μm)</th>
                <th>治疗阶段</th>
                <th>版本</th>
                <th>状态</th>
                <th>排程</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r) => {
                const v = latestVersion(r);
                const locked = isLocked(r);
                const schedulable = canSchedule(r);
                const scheduled = hasSchedule(r);
                return (
                  <tr
                    key={r.id}
                    className={v.flagged ? "row-flagged" : locked ? "row-locked" : ""}
                  >
                    <td>
                      <strong>{r.patientName}</strong>
                      {r.mrn && <span className="muted small"> {r.mrn}</span>}
                      <br />
                      <span className="eye-tag">{r.eye}</span>
                    </td>
                    <td>{r.examDate}</td>
                    <td className={v.thinnest < 400 ? "danger-text" : ""}>
                      {v.thinnest}
                    </td>
                    <td>{v.kmax}</td>
                    <td className={v.change6m > 25 ? "danger-text" : ""}>
                      {v.change6m}
                    </td>
                    <td>{v.stage}</td>
                    <td>
                      <button
                        type="button"
                        className="link-btn"
                        onClick={() => setOpenId(r.id)}
                        title="查看版本链"
                      >
                        v{v.version}
                        {v.version > 1 ? ` (${r.versions.length})` : ""} ↗
                      </button>
                    </td>
                    <td>
                      <span className={`badge badge-${v.status}`}>
                        {STATUS_LABEL[v.status]}
                      </span>
                      {v.confirmedBy && (
                        <span className="muted small block">
                          {v.confirmedBy}
                        </span>
                      )}
                    </td>
                    <td>
                      {scheduled ? (
                        r.schedules.map((s) => (
                          <span key={s.id} className="schedule-pill" title={`排程人 ${s.createdBy}`}>
                            {s.slotDate}
                            <br />
                            {s.slot}
                          </span>
                        ))
                      ) : v.flagged ? (
                        <span className="muted small">不可排程</span>
                      ) : schedulable ? (
                        <span className="muted small">可排程</span>
                      ) : (
                        <span className="muted small">待确认</span>
                      )}
                    </td>
                    <td>
                      <div className="row-actions">
                        {!locked && (
                          <button
                            type="button"
                            className="mini-btn"
                            disabled={v.flagged && !isSpecialist}
                            title={
                              v.flagged && !isSpecialist
                                ? "触发专科阈值，需切换为专科医师身份确认"
                                : undefined
                            }
                            onClick={() => handleConfirm(r)}
                          >
                            {v.flagged ? "专科确认" : "确认"}
                          </button>
                        )}
                        {schedulable && !scheduled && (
                          <button
                            type="button"
                            className="mini-btn primary"
                            onClick={() => onGoSchedule(r.id)}
                          >
                            排设备
                          </button>
                        )}
                        {!locked && !scheduled && (
                          <button
                            type="button"
                            className="mini-btn danger"
                            onClick={() => handleDelete(r)}
                          >
                            删除
                          </button>
                        )}
                        {locked && (
                          <span className="lock-hint" title="检查与排程已锁定">
                            🔒
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {openRecord && (
        <VersionModal record={openRecord} onClose={() => setOpenId(null)} />
      )}
    </section>
  );
}
