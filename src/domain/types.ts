// 领域模型：随访记录、版本链、设备占用

export type EyeSide = "OD" | "OS";

export type TreatmentStage = "观察随访" | "配镜矫正" | "交联术前评估" | "交联术后随访";

/** pending = 待确认（含转专科待确认）；confirmed = 已确认锁定 */
export type RecordStatus = "pending" | "confirmed";

/** 一次复诊录入的参数 */
export interface VisitValues {
  patient: string;
  eye: EyeSide;
  examDate: string; // YYYY-MM-DD
  thinnest: number; // 角膜最薄点 μm
  kmax: number; // Kmax (D)
  change6m: number; // 半年变化量 μm
  stage: TreatmentStage;
}

/** 带原因的参数版本，versions[0] 为首版，末位为当前值 */
export interface VisitVersion extends VisitValues {
  version: number;
  reason: string;
  createdAt: string; // ISO
}

export interface VisitRecord {
  id: string;
  /** 去重键：患者|检查日期|眼别，同一患者同一天同眼只留一条 */
  key: string;
  status: RecordStatus;
  /** 是否触发转专科（按当前版本参数判定） */
  needsSpecialist: boolean;
  triageReasons: string[];
  createdAt: string;
  updatedAt: string;
  versions: VisitVersion[];
}

/** 交联设备占用：同一时段只能排一人 */
export interface DeviceBooking {
  id: string;
  recordId: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:mm
  createdAt: string;
}

export interface DeskState {
  records: VisitRecord[];
  bookings: DeviceBooking[];
}

export const EYE_LABEL: Record<EyeSide, string> = {
  OD: "右眼",
  OS: "左眼",
};

export const TREATMENT_STAGES: TreatmentStage[] = [
  "观察随访",
  "配镜矫正",
  "交联术前评估",
  "交联术后随访",
];

/** 当前生效参数 = 版本链末位 */
export function currentOf(record: VisitRecord): VisitVersion {
  return record.versions[record.versions.length - 1];
}
