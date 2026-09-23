import type {
  Eye,
  FollowUpRecord,
  RecordFilters,
  RecordVersion,
  Schedule,
  Stage,
  Summary,
  VersionStatus,
  VisitInput,
  VisitValues,
} from "../types";

// ---- 判定阈值（临床规则集中在此层，不与存储 / 页面耦合） ----

/** 角膜最薄点低于该值（μm）→ 转专科待确认，不允许占用交联设备 */
export const MIN_THICKNESS = 400;

/** 半年变化量超过该值（μm）→ 转专科待确认 */
export const MAX_CHANGE_6M = 25;

export const STAGES: Stage[] = [
  "初诊筛查",
  "进展观察",
  "拟交联评估",
  "交联术后随访",
  "硬性接触镜随访",
  "移植评估",
];

export const EYES: Eye[] = ["右眼", "左眼"];

/** 交联设备可排时段（一台设备） */
export const SLOTS = [
  "08:00",
  "09:00",
  "10:00",
  "11:00",
  "13:00",
  "14:00",
  "15:00",
  "16:00",
];

export const STATUS_LABEL: Record<VersionStatus, string> = {
  pending: "待确认",
  specialist: "转专科待确认",
  confirmed: "已确认锁定",
};

/** 阈值判定：返回是否需要转专科及触发原因；输入本身始终保留 */
export function evaluate(values: VisitValues): {
  flagged: boolean;
  reasons: string[];
} {
  const reasons: string[] = [];
  if (values.thinnest < MIN_THICKNESS) {
    reasons.push(`最薄点 ${values.thinnest}μm < ${MIN_THICKNESS}μm`);
  }
  if (values.change6m > MAX_CHANGE_6M) {
    reasons.push(`半年变化 ${values.change6m}μm > ${MAX_CHANGE_6M}μm`);
  }
  return { flagged: reasons.length > 0, reasons };
}

/** 同一患者同一天同眼的唯一键 */
export function recordKey(
  name: string,
  date: string,
  eye: Eye
): string {
  return `${name.trim()}|${date}|${eye}`;
}

export function recordKeyOf(r: {
  patientName: string;
  examDate: string;
  eye: Eye;
}): string {
  return recordKey(r.patientName, r.examDate, r.eye);
}

export function latestVersion(record: FollowUpRecord): RecordVersion {
  return record.versions[record.versions.length - 1];
}

/** 记录当前状态（取最新版本） */
export function recordStatus(record: FollowUpRecord): VersionStatus {
  return latestVersion(record).status;
}

/** 已确认锁定的检查才允许排交联设备；转专科的即使专科确认过也不允许 */
export function canSchedule(record: FollowUpRecord): boolean {
  const v = latestVersion(record);
  return v.status === "confirmed" && !v.flagged;
}

/** 记录是否已锁定（确认后的检查与排程均锁定） */
export function isLocked(record: FollowUpRecord): boolean {
  return latestVersion(record).status === "confirmed";
}

/** 排程是否已锁定（排程一经创建即跟随已确认版本，不可再改动） */
export function isScheduleLocked(): boolean {
  return true;
}

export function hasSchedule(record: FollowUpRecord): boolean {
  return record.schedules.length > 0;
}

// ---- 数据操作（纯函数，返回新数组/新对象，便于测试与持久化分离） ----

export interface UpsertResult {
  records: FollowUpRecord[];
  outcome:
    | { type: "created" }
    | { type: "updated-pending" }
    | { type: "new-version" }
    | { type: "unchanged" };
}

function makeId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function sameValues(a: VisitValues, b: VisitValues): boolean {
  return (
    a.thinnest === b.thinnest &&
    a.kmax === b.kmax &&
    a.change6m === b.change6m &&
    a.stage === b.stage
  );
}

/**
 * 录入 / 复诊再录入。
 * - 唯一键不存在：新建，状态由阈值判定决定
 * - 存在且尚未确认：直接更新当前版本（仍保留输入），状态重新判定
 * - 存在且已确认锁定 + 参数一致：不变
 * - 存在且已确认锁定 + 参数变化：追加带原因的新版本，回到待确认/转专科，
 *   旧值在版本链中仍可查；已有排程属于旧版本，保留不动
 */
export function upsertVisit(
  records: FollowUpRecord[],
  input: VisitInput,
  reason: string,
  now: string = new Date().toISOString()
): UpsertResult {
  const key = recordKey(input.patientName, input.examDate, input.eye);
  const index = records.findIndex(
    (r) => recordKeyOf(r) === key
  );

  if (index === -1) {
    const { flagged, reasons } = evaluate(input);
    const record: FollowUpRecord = {
      id: makeId(),
      patientName: input.patientName.trim(),
      mrn: input.mrn.trim(),
      eye: input.eye,
      examDate: input.examDate,
      createdAt: now,
      updatedAt: now,
      versions: [
        {
          version: 1,
          createdAt: now,
          thinnest: input.thinnest,
          kmax: input.kmax,
          change6m: input.change6m,
          stage: input.stage,
          status: flagged ? "specialist" : "pending",
          flagged,
          flagReasons: reasons,
        },
      ],
      schedules: [],
    };
    return { records: [record, ...records], outcome: { type: "created" } };
  }

  const record = records[index];
  const current = latestVersion(record);

  // 已锁定 + 参数无变化：拒绝重复制造版本
  if (current.status === "confirmed" && sameValues(current, input)) {
    return { records, outcome: { type: "unchanged" } };
  }

  let nextRecord: FollowUpRecord;
  let outcome: UpsertResult["outcome"];

  if (current.status !== "confirmed") {
    // 未确认：更新当前版本，重新走阈值判定
    const { flagged, reasons } = evaluate(input);
    const versions = record.versions.slice();
    versions[versions.length - 1] = {
      ...current,
      thinnest: input.thinnest,
      kmax: input.kmax,
      change6m: input.change6m,
      stage: input.stage,
      flagged,
      flagReasons: reasons,
      status: flagged ? "specialist" : "pending",
    };
    nextRecord = { ...record, mrn: input.mrn.trim(), versions, updatedAt: now };
    outcome = { type: "updated-pending" };
  } else {
    // 已确认锁定：参数变化必须填写原因，追加新版本
    if (!reason.trim()) {
      throw new Error("已锁定的检查参数发生变化，必须填写变化原因后才能新建版本");
    }
    const { flagged, reasons } = evaluate(input);
    const next: RecordVersion = {
      version: current.version + 1,
      createdAt: now,
      reason: reason.trim(),
      thinnest: input.thinnest,
      kmax: input.kmax,
      change6m: input.change6m,
      stage: input.stage,
      status: flagged ? "specialist" : "pending",
      flagged,
      flagReasons: reasons,
    };
    nextRecord = {
      ...record,
      mrn: input.mrn.trim(),
      versions: [...record.versions, next],
      updatedAt: now,
    };
    outcome = { type: "new-version" };
  }

  const next = records.slice();
  next[index] = nextRecord;
  return { records: next, outcome };
}

/**
 * 确认检查：
 * - 普通记录：任意操作员可确认
 * - 触发专科阈值的记录：必须专科医师确认，确认后仍不能占用交联设备
 */
export function confirmVersion(
  records: FollowUpRecord[],
  recordId: string,
  operator: string,
  isSpecialist: boolean
): FollowUpRecord[] {
  return records.map((r) => {
    if (r.id !== recordId) return r;
    const v = latestVersion(r);
    if (v.status === "confirmed") return r;
    if (v.flagged && !isSpecialist) {
      throw new Error("该记录触发专科阈值，需由专科医师确认");
    }
    const versions = r.versions.slice();
    versions[versions.length - 1] = {
      ...v,
      status: "confirmed",
      confirmedAt: new Date().toISOString(),
      confirmedBy: operator.trim() || "未署名",
      specialist: v.flagged ? true : isSpecialist,
    };
    return { ...r, versions, updatedAt: new Date().toISOString() };
  });
}

/** 设备同一时段只能排一人；仅「已确认锁定且未触发阈值」的记录可排程 */
export function addSchedule(
  records: FollowUpRecord[],
  recordId: string,
  slotDate: string,
  slot: string,
  operator: string
): FollowUpRecord[] {
  const record = records.find((r) => r.id === recordId);
  if (!record) throw new Error("记录不存在");
  if (!canSchedule(record)) {
    throw new Error("仅已确认且未触发专科阈值的检查可以占用交联设备");
  }
  if (hasSchedule(record)) {
    throw new Error("该记录已有交联排程，排程确认后不可重复安排");
  }
  // 全局检查时段冲突（一台设备）
  for (const r of records) {
    for (const s of r.schedules) {
      if (s.slotDate === slotDate && s.slot === slot) {
        throw new Error(
          `${slotDate} ${slot} 已安排 ${r.patientName}（${r.eye}），设备同一时段只能排一人`
        );
      }
    }
  }
  const schedule: Schedule = {
    id: makeId(),
    versionId: latestVersion(record).version,
    slotDate,
    slot,
    createdAt: new Date().toISOString(),
    createdBy: operator.trim() || "未署名",
  };
  return records.map((r) =>
    r.id === recordId
      ? { ...r, schedules: [...r.schedules, schedule] }
      : r
  );
}

/** 仅未确认、且没有锁定排程的记录可删除（已锁定不提供删除入口，双保险） */
export function deleteRecord(
  records: FollowUpRecord[],
  recordId: string
): FollowUpRecord[] {
  const record = records.find((r) => r.id === recordId);
  if (!record) return records;
  if (isLocked(record)) {
    throw new Error("已确认锁定的检查不能删除");
  }
  if (record.schedules.length > 0) {
    throw new Error("存在排程的记录不能删除");
  }
  return records.filter((r) => r.id !== recordId);
}

// ---- 查询 / 统计 ----

export function summarize(
  records: FollowUpRecord[],
  today: string = new Date().toISOString().slice(0, 10)
): Summary {
  const s: Summary = {
    total: records.length,
    pending: 0,
    specialist: 0,
    confirmed: 0,
    scheduled: 0,
    scheduledToday: 0,
  };
  for (const r of records) {
    const status = recordStatus(r);
    if (status === "pending") s.pending += 1;
    if (status === "specialist") s.specialist += 1;
    if (status === "confirmed") s.confirmed += 1;
    if (r.schedules.length > 0) {
      s.scheduled += 1;
      if (r.schedules.some((sc) => sc.slotDate === today)) {
        s.scheduledToday += 1;
      }
    }
  }
  return s;
}

export function applyFilters(
  records: FollowUpRecord[],
  f: RecordFilters
): FollowUpRecord[] {
  const q = f.query.trim().toLowerCase();
  return records.filter((r) => {
    const v = latestVersion(r);
    if (
      q &&
      !`${r.patientName} ${r.mrn}`.toLowerCase().includes(q)
    )
      return false;
    if (f.eye !== "all" && r.eye !== f.eye) return false;
    if (f.status !== "all" && v.status !== f.status) return false;
    if (f.stage !== "all" && v.stage !== f.stage) return false;
    if (f.risk === "flagged" && !v.flagged) return false;
    if (f.risk === "normal" && v.flagged) return false;
    return true;
  });
}

export function todayString(): string {
  return new Date().toISOString().slice(0, 10);
}
