// 领域数据模型：圆锥角膜随访台

export type Eye = "左眼" | "右眼";

export type Stage =
  | "初诊筛查"
  | "进展观察"
  | "拟交联评估"
  | "交联术后随访"
  | "硬性接触镜随访"
  | "移植评估";

/** 版本状态：待确认 / 转专科待确认 / 已确认锁定 */
export type VersionStatus = "pending" | "specialist" | "confirmed";

/** 一次复查录入的临床参数 */
export interface VisitValues {
  /** 角膜最薄点厚度，单位 μm */
  thinnest: number;
  /** 最大角膜曲率 Kmax，单位 D */
  kmax: number;
  /** 半年变化量（最薄点/进展），单位 μm */
  change6m: number;
  /** 治疗阶段 */
  stage: Stage;
}

/**
 * 参数版本。确认后的检查被锁定；之后同一患者同一天同眼再录入且参数变化，
 * 不覆盖旧值，而是追加一个带原因的新版本，旧版本仍可在版本链中查询。
 */
export interface RecordVersion extends VisitValues {
  version: number;
  createdAt: string;
  /** v2+ 必填：复诊参数变化原因 */
  reason?: string;
  status: VersionStatus;
  /** 是否触发专科阈值 */
  flagged: boolean;
  flagReasons: string[];
  confirmedAt?: string;
  confirmedBy?: string;
  /** 是否经专科医师确认（触发阈值的记录只能专科确认） */
  specialist?: boolean;
}

/** 设备排程：一台交联设备，一个时段只能有一人，确认后锁定 */
export interface Schedule {
  id: string;
  /** 对应的版本号，排程跟随当时确认锁定的版本 */
  versionId: number;
  /** YYYY-MM-DD */
  slotDate: string;
  /** HH:00 */
  slot: string;
  createdAt: string;
  createdBy: string;
}

/** 同一患者 + 同一天 + 同眼 = 唯一一条随访记录 */
export interface FollowUpRecord {
  id: string;
  patientName: string;
  mrn: string;
  eye: Eye;
  /** 检查日期 YYYY-MM-DD */
  examDate: string;
  createdAt: string;
  updatedAt: string;
  versions: RecordVersion[];
  schedules: Schedule[];
}

export interface VisitInput extends VisitValues {
  patientName: string;
  mrn: string;
  eye: Eye;
  examDate: string;
}

export interface Database {
  version: 1;
  records: FollowUpRecord[];
}

export interface Summary {
  total: number;
  pending: number;
  specialist: number;
  confirmed: number;
  scheduled: number;
  scheduledToday: number;
}

export type StatusFilter = "all" | VersionStatus;
export type RiskFilter = "all" | "flagged" | "normal";

export interface RecordFilters {
  query: string;
  eye: "all" | Eye;
  status: StatusFilter;
  stage: "all" | Stage;
  risk: RiskFilter;
}
