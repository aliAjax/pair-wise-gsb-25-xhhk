import type { Database, FollowUpRecord } from "../types";
import { evaluate } from "./rules";

// 存储层：只负责落盘 / 读取 / 迁移，不包含业务判定
// 所有数据放在一个带版本号的键下，重开页面后记录、设备占用与版本链都还在

const STORAGE_KEY = "kc-followup-desk-v1";

export function emptyDatabase(): Database {
  return { version: 1, records: [] };
}

export function loadDatabase(): Database {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyDatabase();
    const parsed = JSON.parse(raw) as Database;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.records)) {
      return emptyDatabase();
    }
    return parsed;
  } catch {
    return emptyDatabase();
  }
}

export function saveDatabase(db: Database): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
}

export function clearDatabase(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function serializeDatabase(db: Database): string {
  return JSON.stringify(db, null, 2);
}

export function parseDatabase(text: string): Database {
  const parsed = JSON.parse(text) as Database;
  if (!parsed || !Array.isArray(parsed.records)) {
    throw new Error("文件内容不是有效的随访台数据");
  }
  // 轻量校验关键字段
  for (const r of parsed.records as FollowUpRecord[]) {
    if (
      !r.id ||
      !r.patientName ||
      !r.examDate ||
      !r.eye ||
      !Array.isArray(r.versions) ||
      r.versions.length === 0
    ) {
      throw new Error("数据中存在缺少关键字段的记录");
    }
  }
  return { version: 1, records: parsed.records };
}

// ---- 首次使用的示例数据 ----

function isoDaysAgo(days: number, hour: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

function dateDaysAgo(days: number): string {
  return isoDaysAgo(days, 9).slice(0, 10);
}

interface SeedSpec {
  name: string;
  mrn: string;
  eye: "右眼" | "左眼";
  daysAgo: number;
  thinnest: number;
  kmax: number;
  change6m: number;
  stage: FollowUpRecord["versions"][number]["stage"];
  confirmed: boolean;
  specialistConfirm?: boolean;
  scheduleOffsetDays?: number;
  scheduleSlot?: string;
}

const SEEDS: SeedSpec[] = [
  {
    name: "张维",
    mrn: "KC-2041",
    eye: "右眼",
    daysAgo: 3,
    thinnest: 452,
    kmax: 51.8,
    change6m: 12,
    stage: "进展观察",
    confirmed: true,
  },
  {
    name: "李沐",
    mrn: "KC-2108",
    eye: "左眼",
    daysAgo: 6,
    thinnest: 386,
    kmax: 58.4,
    change6m: 18,
    stage: "拟交联评估",
    confirmed: true,
    specialistConfirm: true,
  },
  {
    name: "王珊",
    mrn: "KC-1873",
    eye: "右眼",
    daysAgo: 1,
    thinnest: 428,
    kmax: 49.2,
    change6m: 31,
    stage: "进展观察",
    confirmed: false,
  },
  {
    name: "陈放",
    mrn: "KC-1650",
    eye: "左眼",
    daysAgo: 10,
    thinnest: 471,
    kmax: 47.6,
    change6m: 6,
    stage: "交联术后随访",
    confirmed: true,
    scheduleOffsetDays: 2,
    scheduleSlot: "10:00",
  },
  {
    name: "赵青",
    mrn: "KC-2205",
    eye: "右眼",
    daysAgo: 0,
    thinnest: 411,
    kmax: 53.7,
    change6m: 9,
    stage: "初诊筛查",
    confirmed: false,
  },
];

/** 生成示例数据（用判定层算阈值，保证与真实录入一致） */
export function seedDatabase(): Database {
  const nowIso = new Date().toISOString();
  const records: FollowUpRecord[] = SEEDS.map((s, i) => {
    const created = isoDaysAgo(s.daysAgo, 9 + (i % 8));
    const { flagged, reasons } = evaluate({
      thinnest: s.thinnest,
      kmax: s.kmax,
      change6m: s.change6m,
      stage: s.stage,
    });
    const confirmedAt =
      s.confirmed && (!flagged || s.specialistConfirm)
        ? isoDaysAgo(Math.max(0, s.daysAgo - 1), 15)
        : undefined;

    const record: FollowUpRecord = {
      id: `seed-${i + 1}`,
      patientName: s.name,
      mrn: s.mrn,
      eye: s.eye,
      examDate: dateDaysAgo(s.daysAgo),
      createdAt: created,
      updatedAt: confirmedAt ?? created,
      versions: [
        {
          version: 1,
          createdAt: created,
          thinnest: s.thinnest,
          kmax: s.kmax,
          change6m: s.change6m,
          stage: s.stage,
          status: !s.confirmed
            ? flagged
              ? "specialist"
              : "pending"
            : "confirmed",
          flagged,
          flagReasons: reasons,
          confirmedAt,
          confirmedBy: s.specialistConfirm ? "宋主任（专科）" : s.confirmed ? "门诊医师" : undefined,
          specialist: s.specialistConfirm ? true : undefined,
        },
      ],
      schedules: [],
    };

    if (s.scheduleOffsetDays !== undefined && s.scheduleSlot) {
      const slotDate = dateDaysAgo(-s.scheduleOffsetDays);
      record.schedules = [
        {
          id: `seed-sched-${i + 1}`,
          versionId: 1,
          slotDate,
          slot: s.scheduleSlot,
          createdAt: nowIso,
          createdBy: "门诊医师",
        },
      ];
    }
    return record;
  });

  return { version: 1, records };
}
