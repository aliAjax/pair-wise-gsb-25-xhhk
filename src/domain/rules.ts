// 判定规则：转专科阈值、去重键、设备占用约束

import type { DeviceBooking, VisitRecord, VisitValues } from "./types";

export const THINNEST_LIMIT_UM = 400;
export const CHANGE_6M_LIMIT_UM = 25;

export const DEVICE_NAME = "交联设备";
export const DEVICE_SLOTS = ["09:00", "10:00", "11:00", "14:00", "15:00", "16:00"];

/** 同一患者同一天同眼只留一条 */
export function recordKey(patient: string, examDate: string, eye: string): string {
  return `${patient.trim().toLowerCase()}|${examDate}|${eye}`;
}

/** 最薄点 < 400μm 或半年变化 > 25μm → 转专科待确认 */
export function evaluateTriage(values: VisitValues): { needsSpecialist: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (values.thinnest < THINNEST_LIMIT_UM) {
    reasons.push(`角膜最薄点 ${values.thinnest}μm 低于 ${THINNEST_LIMIT_UM}μm`);
  }
  if (values.change6m > CHANGE_6M_LIMIT_UM) {
    reasons.push(`半年变化量 ${values.change6m}μm 超过 ${CHANGE_6M_LIMIT_UM}μm`);
  }
  return { needsSpecialist: reasons.length > 0, reasons };
}

/** 转专科待确认的记录不能占用交联设备 */
export function canOccupyDevice(record: VisitRecord): boolean {
  return !record.needsSpecialist;
}

/** 设备同一时段只能排一人 */
export function findSlotConflict(
  bookings: DeviceBooking[],
  date: string,
  time: string
): DeviceBooking | undefined {
  return bookings.find((b) => b.date === date && b.time === time);
}
