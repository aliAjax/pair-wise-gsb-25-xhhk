import {
  addSchedule,
  canSchedule,
  confirmVersion,
  deleteRecord,
  latestVersion,
  recordStatus,
  summarize,
  upsertVisit,
} from "../src/domain/rules.ts";
import type { FollowUpRecord, VisitInput } from "../src/types.ts";

let records: FollowUpRecord[] = [];
const base: VisitInput = {
  patientName: "甲",
  mrn: "",
  eye: "右眼",
  examDate: "2026-09-23",
  thinnest: 450,
  kmax: 52,
  change6m: 10,
  stage: "进展观察",
};
let r = upsertVisit(records, base, "");
records = r.records;
console.assert(r.outcome.type === "created", "1 created");
console.assert(recordStatus(records[0]) === "pending", "2 pending");

// 同患者同日同眼再录（未确认）→ 更新而非新增
r = upsertVisit(records, { ...base, kmax: 53 }, "");
records = r.records;
console.assert(r.outcome.type === "updated-pending", "3 updated-pending");
console.assert(records.length === 1, "4 still one record");
console.assert(records[0].versions.length === 1, "5 no new version");

// 确认
records = confirmVersion(records, records[0].id, "医生", false);
console.assert(recordStatus(records[0]) === "confirmed", "6 confirmed");

// 锁定后相同参数 → unchanged
r = upsertVisit(records, { ...base, kmax: 53 }, "");
console.assert(r.outcome.type === "unchanged", "7 unchanged");

// 锁定后改参数但无原因 → 抛错
let threw = false;
try {
  upsertVisit(records, { ...base, kmax: 55 }, "");
} catch {
  threw = true;
}
console.assert(threw, "8 reason required");

// 锁定后改参数+原因 → 新版本
r = upsertVisit(records, { ...base, kmax: 55 }, "复测");
records = r.records;
console.assert(r.outcome.type === "new-version", "9 new version");
console.assert(records[0].versions.length === 2, "10 version chain");
console.assert(latestVersion(records[0]).kmax === 55, "11 new value");
console.assert(records[0].versions[0].kmax === 53, "12 old value kept");
console.assert(recordStatus(records[0]) === "pending", "13 back to pending");

// 阈值：最薄点 < 400 → specialist，且不可排程
r = upsertVisit(records, { ...base, thinnest: 390, kmax: 55 }, "变薄");
records = r.records;
console.assert(recordStatus(records[0]) === "specialist", "14 specialist by thickness");
console.assert(!canSchedule(records[0]), "15 cannot schedule while pending");

// 普通医师不能确认转专科
threw = false;
try {
  confirmVersion(records, records[0].id, "医生", false);
} catch {
  threw = true;
}
console.assert(threw, "16 specialist confirm required");
records = confirmVersion(records, records[0].id, "宋主任", true);
console.assert(recordStatus(records[0]) === "confirmed", "17 specialist confirmed");
console.assert(!canSchedule(records[0]), "18 flagged never schedules");

// 另一患者：正常确认后可排程，且同时段冲突
const other: VisitInput = {
  ...base,
  patientName: "乙",
  examDate: "2026-09-24",
  thinnest: 460,
  change6m: 5,
};
r = upsertVisit(records, other, "");
records = r.records;
records = confirmVersion(records, records[0].id === "x" ? "x" : records.find((x) => x.patientName === "乙")!.id, "医生", false);
const yi = records.find((x) => x.patientName === "乙")!;
console.assert(canSchedule(yi), "19 yi schedulable");
records = addSchedule(records, yi.id, "2026-09-30", "10:00", "医生");
const jia = records.find((x) => x.patientName === "甲")!;
threw = false;
try {
  // 甲是 flagged，即使确认也不能排
  addSchedule(records, jia.id, "2026-09-30", "11:00", "医生");
} catch {
  threw = true;
}
console.assert(threw, "20 flagged blocked from device");

// 丙与乙抢同一时段
const bingInput: VisitInput = { ...other, patientName: "丙" };
r = upsertVisit(records, bingInput, "");
records = r.records;
records = confirmVersion(records, records.find((x) => x.patientName === "丙")!.id, "医生", false);
threw = false;
try {
  addSchedule(records, records.find((x) => x.patientName === "丙")!.id, "2026-09-30", "10:00", "医生");
} catch {
  threw = true;
}
console.assert(threw, "21 slot conflict");
// 不同时段可排
records = addSchedule(records, records.find((x) => x.patientName === "丙")!.id, "2026-09-30", "11:00", "医生");
console.assert(records.find((x) => x.patientName === "丙")!.schedules.length === 1, "22 other slot ok");

// 半年变化 > 25 → specialist
const prog: VisitInput = { ...other, patientName: "丁", change6m: 26 };
r = upsertVisit(records, prog, "");
records = r.records;
console.assert(recordStatus(records.find((x) => x.patientName === "丁")!) === "specialist", "23 specialist by change");

// 删除：已锁定的不能删
threw = false;
try {
  deleteRecord(records, yi.id);
} catch {
  threw = true;
}
console.assert(threw, "24 locked cannot delete");

const s = summarize(records, "2026-09-23");
console.log("summary", s);
console.assert(s.total === 4, "25 total");
console.assert(s.scheduled === 2, "26 scheduled");

console.log("ALL DOMAIN TESTS PASSED");
