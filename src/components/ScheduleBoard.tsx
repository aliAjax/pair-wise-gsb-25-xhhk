import { useEffect, useMemo, useState } from "react";
import type { FollowUpRecord } from "../types";
import type { Store } from "../data/useStore";
import {
  SLOTS,
  canSchedule,
  latestVersion,
  recordKeyOf,
  todayString,
} from "../domain/rules";

interface Props {
  store: Store;
  operator: string;
  preselectRecordId: string | null;
  onConsumePreselect: () => void;
  onToast: (msg: string, kind?: "ok" | "err") => void;
}

/** 交联设备排程台：一台设备，一个日期+时段只能排一人；排程创建即锁定 */
export function ScheduleBoard({
  store,
  operator,
  preselectRecordId,
  onConsumePreselect,
  onToast,
}: Props) {
  const [date, setDate] = useState(todayString());
  const [recordId, setRecordId] = useState("");

  // 仅「已确认锁定且未触发阈值」的记录能被选入排程
  const eligible = useMemo(
    () =>
      store.records
        .filter((r) => canSchedule(r) && r.schedules.length === 0)
        .sort((a, b) => recordKeyOf(a).localeCompare(recordKeyOf(b))),
    [store.records]
  );

  useEffect(() => {
    if (preselectRecordId) {
      setRecordId(preselectRecordId);
      onConsumePreselect();
    }
  }, [preselectRecordId, onConsumePreselect]);

  // 日期 -> 时段 -> 占用记录
  const occupancy = useMemo(() => {
    const map = new Map<string, { record: FollowUpRecord; slot: string }>();
    for (const r of store.records) {
      for (const s of r.schedules) {
        if (s.slotDate === date) map.set(s.slot, { record: r, slot: s.slot });
      }
    }
    return map;
  }, [store.records, date]);

  // 所有排程按日期排序（便于查看设备占用）
  const allSchedules = useMemo(() => {
    return store.records
      .flatMap((r) =>
        r.schedules.map((s) => ({ record: r, slotDate: s.slotDate, slot: s.slot, by: s.createdBy, v: s.versionId }))
      )
      .sort((a, b) =>
        a.slotDate === b.slotDate
          ? a.slot.localeCompare(b.slot)
          : a.slotDate.localeCompare(b.slotDate)
      );
  }, [store.records]);

  function book(slot: string) {
    if (!recordId) {
      onToast("请先选择一条已确认、可排程的检查记录", "err");
      return;
    }
    const r = store.records.find((x) => x.id === recordId);
    const name = r ? `${r.patientName}（${r.eye}）` : "";
    try {
      store.schedule(recordId, date, slot, operator);
      onToast(`已排程：${name} ${date} ${slot}，设备占用已锁定`, "ok");
      setRecordId("");
    } catch (e) {
      onToast(e instanceof Error ? e.message : "排程失败", "err");
    }
  }

  return (
    <div className="schedule-layout">
      <section className="panel schedule-board">
        <div className="section-heading">
          <div>
            <p>交联设备（共 1 台）</p>
            <h2>设备时段占用</h2>
          </div>
          <label className="date-picker">
            <span>查看日期</span>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
        </div>

        <label className="record-picker">
          <span>选择待排检查（仅显示已确认锁定且未触发专科阈值的记录）</span>
          <select
            value={recordId}
            onChange={(e) => setRecordId(e.target.value)}
          >
            <option value="">— 请选择患者 / 日期 / 眼别 —</option>
            {eligible.map((r) => {
              const v = latestVersion(r);
              return (
                <option key={r.id} value={r.id}>
                  {r.patientName}（{r.mrn || "无病历号"}）· {r.eye} · 检查日{" "}
                  {r.examDate} · 最薄点 {v.thinnest}μm · {v.stage}
                </option>
              );
            })}
          </select>
        </label>
        {eligible.length === 0 && (
          <p className="muted small">
            当前没有可排程记录。转专科或未确认的记录不会出现在这里。
          </p>
        )}

        <div className="slots-grid">
          {SLOTS.map((slot) => {
            const occ = occupancy.get(slot);
            return (
              <div
                key={slot}
                className={`slot ${occ ? "slot-busy" : "slot-free"}`}
              >
                <div className="slot-time">{slot}</div>
                {occ ? (
                  <div className="slot-info">
                    <strong>
                      {occ.record.patientName} · {occ.record.eye}
                    </strong>
                    <span className="muted small">
                      检查日 {occ.record.examDate}
                    </span>
                    <span className="badge badge-confirmed">已锁定</span>
                  </div>
                ) : (
                  <div className="slot-info">
                    <span className="muted">空闲</span>
                    <button
                      type="button"
                      className="mini-btn primary"
                      disabled={!recordId}
                      onClick={() => book(slot)}
                    >
                      排入
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className="panel schedule-list">
        <div className="section-heading">
          <div>
            <p>设备占用台账</p>
            <h2>
              全部排程 <span className="count-tag">{allSchedules.length}</span>
            </h2>
          </div>
        </div>
        {allSchedules.length === 0 ? (
          <div className="empty-state">暂无排程。</div>
        ) : (
          <ul className="schedule-ul">
            {allSchedules.map((s) => (
              <li key={`${s.slotDate}-${s.slot}-${s.record.id}`}>
                <div>
                  <strong>
                    {s.slotDate} {s.slot}
                  </strong>
                  <span className="muted small">
                    {" "}
                    · {s.record.patientName}（{s.record.mrn || "无号"}）·{" "}
                    {s.record.eye} · 基于 v{s.v}
                  </span>
                </div>
                <span className="badge badge-confirmed">已锁定</span>
              </li>
            ))}
          </ul>
        )}
        <p className="muted small schedule-footnote">
          排程一经确认即锁定，不提供取消或改期；如需调整请走线下专科流程。
          触发专科阈值（最薄点 &lt; 400μm 或半年变化 &gt; 25μm）的记录即使经专科确认也不能占用设备。
        </p>
      </section>
    </div>
  );
}
