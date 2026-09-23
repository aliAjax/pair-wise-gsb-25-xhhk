// 存储层：localStorage 落盘 + 纯函数状态操作（重开页面后记录、设备占用、版本链都在）

import { evaluateTriage, findSlotConflict, recordKey } from "../domain/rules";
import type { DeskState, DeviceBooking, VisitRecord, VisitValues, VisitVersion } from "../domain/types";
import { currentOf } from "../domain/types";

const STORAGE_KEY = "kc-followup-desk-v1";

export type OpResult =
  | { ok: true; state: DeskState; message: string }
  | { ok: false; error: string };

export function uid(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function loadState(): DeskState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DeskState;
    if (!Array.isArray(parsed.records) || !Array.isArray(parsed.bookings)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveState(state: DeskState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // 存储不可用时保持内存态，不阻断页面
  }
}

function makeVersion(values: VisitValues, version: number, reason: string, createdAt: string): VisitVersion {
  return { ...values, version, reason, createdAt };
}

function applyTriage(record: VisitRecord): VisitRecord {
  const triage = evaluateTriage(currentOf(record));
  return { ...record, needsSpecialist: triage.needsSpecialist, triageReasons: triage.reasons };
}

/**
 * 录入随访：同一患者同一天同眼只留一条。
 * - 已锁定记录：拒绝，提示走「新建版本」。
 * - 待确认记录：原地更新参数并重跑判定。
 * - 触发转专科：保留输入，状态保持待确认，且不能占用交联设备（已占用的释放）。
 */
export function upsertVisit(state: DeskState, values: VisitValues): OpResult {
  const key = recordKey(values.patient, values.examDate, values.eye);
  const now = new Date().toISOString();
  const existing = state.records.find((r) => r.key === key);

  if (existing) {
    if (existing.status === "confirmed") {
      return { ok: false, error: "该患者当日该眼别的记录已确认锁定，请在记录上使用「新建版本」并填写原因。" };
    }
    const versions = [...existing.versions];
    versions[versions.length - 1] = makeVersion(values, versions.length, versions[versions.length - 1].reason, now);
    const updated = applyTriage({ ...existing, versions, updatedAt: now });
    let bookings = state.bookings;
    let extra = "";
    if (updated.needsSpecialist) {
      const before = bookings.length;
      bookings = bookings.filter((b) => b.recordId !== updated.id);
      if (bookings.length !== before) extra = " 已释放其占用的交联设备时段。";
    }
    const records = state.records.map((r) => (r.id === updated.id ? updated : r));
    const message = updated.needsSpecialist
      ? `已更新并保留输入：${updated.triageReasons.join("；")}，转专科待确认，不能占用交联设备。${extra}`
      : "已更新同日同眼记录，未触发转专科阈值。";
    return { ok: true, state: { records, bookings }, message };
  }

  const base: VisitRecord = {
    id: uid(),
    key,
    status: "pending",
    needsSpecialist: false,
    triageReasons: [],
    createdAt: now,
    updatedAt: now,
    versions: [makeVersion(values, 1, "首次录入", now)],
  };
  const record = applyTriage(base);
  const message = record.needsSpecialist
    ? `已保留输入：${record.triageReasons.join("；")}，转专科待确认，不能占用交联设备。`
    : "已录入随访记录，未触发转专科阈值。";
  return { ok: true, state: { ...state, records: [...state.records, record] }, message };
}

/** 确认后检查与排程一并锁定 */
export function confirmRecord(state: DeskState, recordId: string): OpResult {
  const record = state.records.find((r) => r.id === recordId);
  if (!record) return { ok: false, error: "记录不存在。" };
  if (record.status === "confirmed") return { ok: false, error: "记录已确认锁定。" };
  const records = state.records.map((r) =>
    r.id === recordId ? { ...r, status: "confirmed" as const, updatedAt: new Date().toISOString() } : r
  );
  const message = record.needsSpecialist
    ? "专科已确认，检查与排程锁定。后续参数变化请新建带原因的版本。"
    : "已确认，检查与排程锁定。后续参数变化请新建带原因的版本。";
  return { ok: true, state: { ...state, records }, message };
}

/** 复诊参数变化：新建带原因的版本，旧值保留在版本链中可查 */
export function addVersion(state: DeskState, recordId: string, values: VisitValues, reason: string): OpResult {
  const record = state.records.find((r) => r.id === recordId);
  if (!record) return { ok: false, error: "记录不存在。" };
  if (record.status !== "confirmed") return { ok: false, error: "仅已确认锁定的记录需要新建版本；待确认记录可直接修改。" };
  if (!reason.trim()) return { ok: false, error: "请填写版本原因。" };
  if (recordKey(values.patient, values.examDate, values.eye) !== record.key) {
    return { ok: false, error: "版本不可变更患者、检查日期或眼别；如需更换请新录入一条记录。" };
  }
  const now = new Date().toISOString();
  const version = makeVersion(values, record.versions.length + 1, reason.trim(), now);
  let updated = applyTriage({ ...record, versions: [...record.versions, version], updatedAt: now });
  let bookings = state.bookings;
  let extra = "";
  // 新版本触发转专科：回到待确认并释放设备占用
  if (updated.needsSpecialist) {
    const before = bookings.length;
    bookings = bookings.filter((b) => b.recordId !== recordId);
    updated = { ...updated, status: "pending" };
    extra = ` 新版本触发转专科（${updated.triageReasons.join("；")}），记录回到待确认状态${
      bookings.length !== before ? "，已释放设备占用" : ""
    }。`;
  }
  const records = state.records.map((r) => (r.id === recordId ? updated : r));
  return { ok: true, state: { records, bookings }, message: `已保存 v${version.version}，旧版本仍可查询。${extra}` };
}

/** 预约交联设备：转专科记录不可占用；同一时段只能排一人 */
export function bookDevice(state: DeskState, recordId: string, date: string, time: string): OpResult {
  const record = state.records.find((r) => r.id === recordId);
  if (!record) return { ok: false, error: "记录不存在。" };
  if (record.needsSpecialist) return { ok: false, error: "该记录已转专科待确认，不能占用交联设备。" };
  if (!date || !time) return { ok: false, error: "请选择设备日期与时段。" };
  if (state.bookings.some((b) => b.recordId === recordId)) {
    return { ok: false, error: "该记录已有设备排程，请先取消原排程。" };
  }
  const conflict = findSlotConflict(state.bookings, date, time);
  if (conflict) {
    const holder = state.records.find((r) => r.id === conflict.recordId);
    const name = holder ? currentOf(holder).patient : "其他患者";
    return { ok: false, error: `${date} ${time} 已被 ${name} 占用，设备同一时段只能排一人。` };
  }
  const booking: DeviceBooking = { id: uid(), recordId, date, time, createdAt: new Date().toISOString() };
  return { ok: true, state: { ...state, bookings: [...state.bookings, booking] }, message: `已排程 ${date} ${time}。` };
}

/** 取消排程：已确认锁定的记录排程同步锁定，不可取消 */
export function cancelBooking(state: DeskState, bookingId: string): OpResult {
  const booking = state.bookings.find((b) => b.id === bookingId);
  if (!booking) return { ok: false, error: "排程不存在。" };
  const record = state.records.find((r) => r.id === booking.recordId);
  if (record && record.status === "confirmed") {
    return { ok: false, error: "记录已确认锁定，其排程不可取消。" };
  }
  return {
    ok: true,
    state: { ...state, bookings: state.bookings.filter((b) => b.id !== bookingId) },
    message: "已取消设备排程。",
  };
}

/** 首次打开时的演示数据 */
export function seedState(): DeskState {
  const now = new Date().toISOString();
  const mk = (
    values: VisitValues,
    status: "pending" | "confirmed",
    versions: VisitVersion[]
  ): VisitRecord =>
    applyTriage({
      id: uid(),
      key: recordKey(values.patient, values.examDate, values.eye),
      status,
      needsSpecialist: false,
      triageReasons: [],
      createdAt: now,
      updatedAt: now,
      versions,
    });
  const v = (values: VisitValues, version: number, reason: string): VisitVersion => ({
    ...values,
    version,
    reason,
    createdAt: now,
  });

  const flagged = mk(
    { patient: "Patient-201", eye: "OD", examDate: "2026-09-10", thinnest: 386, kmax: 52.3, change6m: 31, stage: "交联术前评估" },
    "pending",
    [v({ patient: "Patient-201", eye: "OD", examDate: "2026-09-10", thinnest: 386, kmax: 52.3, change6m: 31, stage: "交联术前评估" }, 1, "首次录入")]
  );
  const confirmedValues: VisitValues = { patient: "Patient-155", eye: "OS", examDate: "2026-09-12", thinnest: 452, kmax: 46.1, change6m: 8, stage: "观察随访" };
  const confirmed = mk(confirmedValues, "confirmed", [
    v({ ...confirmedValues, thinnest: 458, change6m: 5 }, 1, "首次录入"),
    v(confirmedValues, 2, "复诊复测角膜厚度，更新最薄点"),
  ]);
  const normal = mk(
    { patient: "Patient-176", eye: "OD", examDate: "2026-09-18", thinnest: 470, kmax: 44.2, change6m: 3, stage: "配镜矫正" },
    "pending",
    [v({ patient: "Patient-176", eye: "OD", examDate: "2026-09-18", thinnest: 470, kmax: 44.2, change6m: 3, stage: "配镜矫正" }, 1, "首次录入")]
  );

  const booking: DeviceBooking = { id: uid(), recordId: confirmed.id, date: "2026-09-24", time: "10:00", createdAt: now };
  return { records: [flagged, confirmed, normal], bookings: [booking] };
}
