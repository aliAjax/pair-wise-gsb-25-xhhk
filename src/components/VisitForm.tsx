import { useMemo, useState } from "react";
import type { Eye, Stage } from "../types";
import type { Store } from "../data/useStore";
import {
  EYES,
  MAX_CHANGE_6M,
  MIN_THICKNESS,
  STAGES,
  evaluate,
  latestVersion,
  recordKey,
} from "../domain/rules";

interface Props {
  store: Store;
  onToast: (msg: string, kind?: "ok" | "err") => void;
}

interface FormState {
  patientName: string;
  mrn: string;
  eye: Eye;
  examDate: string;
  thinnest: string;
  kmax: string;
  change6m: string;
  stage: Stage;
  reason: string;
}

function initialForm(): FormState {
  return {
    patientName: "",
    mrn: "",
    eye: "右眼",
    examDate: new Date().toISOString().slice(0, 10),
    thinnest: "",
    kmax: "",
    change6m: "",
    stage: "初诊筛查",
    reason: "",
  };
}

/** 录入区：新增与复诊再录入同一入口；唯一键冲突按规则更新或生成版本 */
export function VisitForm({ store, onToast }: Props) {
  const [form, setForm] = useState<FormState>(initialForm);
  const [formKey, setFormKey] = useState(0);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const numeric = {
    thinnest: Number(form.thinnest),
    kmax: Number(form.kmax),
    change6m: Number(form.change6m),
    stage: form.stage,
  };
  const numbersReady =
    form.thinnest !== "" && form.kmax !== "" && form.change6m !== "";
  const liveEval = useMemo(
    () =>
      numbersReady
        ? evaluate(numeric)
        : { flagged: false, reasons: [] as string[] },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [form.thinnest, form.kmax, form.change6m, form.stage]
  );

  // 同一患者同一天同眼是否已有记录
  const matched = useMemo(() => {
    if (!form.patientName.trim() || !form.examDate) return undefined;
    const key = recordKey(form.patientName, form.examDate, form.eye);
    return store.records.find(
      (r) => `${r.patientName.trim()}|${r.examDate}|${r.eye}` === key
    );
  }, [store.records, form.patientName, form.examDate, form.eye]);

  const matchedLocked = matched
    ? latestVersion(matched).status === "confirmed"
    : false;

  const lockedChanged = useMemo(() => {
    if (!matchedLocked || !numbersReady) return false;
    const cur = latestVersion(matched!);
    return (
      cur.thinnest !== numeric.thinnest ||
      cur.kmax !== numeric.kmax ||
      cur.change6m !== numeric.change6m ||
      cur.stage !== numeric.stage
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matched, matchedLocked, numbersReady, form.thinnest, form.kmax, form.change6m, form.stage]);

  function validate(): string | null {
    if (!form.patientName.trim()) return "请填写患者姓名";
    if (!form.examDate) return "请选择检查日期";
    if (!numbersReady) return "请填写最薄点、Kmax 与半年变化量";
    if (!(numeric.thinnest > 100 && numeric.thinnest < 1200))
      return "最薄点数值不合理（应在 100–1200 μm 之间）";
    if (!(numeric.kmax > 30 && numeric.kmax < 80))
      return "Kmax 数值不合理（应在 30–80 D 之间）";
    if (!(numeric.change6m >= 0 && numeric.change6m < 500))
      return "半年变化量数值不合理（应在 0–500 μm 之间）";
    if (lockedChanged && !form.reason.trim())
      return "该检查已确认锁定，参数变化必须填写原因（将新建版本，旧值保留）";
    return null;
  }

  function submit() {
    const err = validate();
    if (err) {
      onToast(err, "err");
      return;
    }
    try {
      const outcome = store.saveVisit(
        {
          patientName: form.patientName,
          mrn: form.mrn,
          eye: form.eye,
          examDate: form.examDate,
          thinnest: numeric.thinnest,
          kmax: numeric.kmax,
          change6m: numeric.change6m,
          stage: form.stage,
        },
        form.reason
      );
      const messages = {
        created: liveEval.flagged
          ? "已录入：触发专科阈值，转专科待确认，不占用交联设备"
          : "已录入：等待医师确认",
        "updated-pending":
          "同一条待确认记录已更新（未确认前不生成新版本）",
        "new-version":
          "检查已锁定：已按原因新建版本，旧值在版本链中可查",
        unchanged: "与已锁定记录参数一致，未重复生成版本",
      } as const;
      onToast(messages[outcome.type], liveEval.flagged ? "err" : "ok");
      setForm(initialForm());
      setFormKey((k) => k + 1);
    } catch (e) {
      onToast(e instanceof Error ? e.message : "保存失败", "err");
    }
  }

  return (
    <section className="panel entry-panel">
      <div className="section-heading">
        <div>
          <p>随访录入 / 复诊再录入</p>
          <h2>检查记录</h2>
        </div>
        <span className="hint-pill">同患者 · 同日期 · 同眼 仅一条</span>
      </div>

      <div className="field-grid" key={formKey}>
        <label>
          <span>患者姓名 *</span>
          <input
            value={form.patientName}
            placeholder="姓名"
            onChange={(e) => set("patientName", e.target.value)}
          />
        </label>
        <label>
          <span>病历号</span>
          <input
            value={form.mrn}
            placeholder="如 KC-2041（选填）"
            onChange={(e) => set("mrn", e.target.value)}
          />
        </label>

        <label>
          <span>眼别 *</span>
          <div className="seg">
            {EYES.map((e) => (
              <button
                key={e}
                type="button"
                className={form.eye === e ? "seg-btn on" : "seg-btn"}
                onClick={() => set("eye", e)}
              >
                {e}
              </button>
            ))}
          </div>
        </label>
        <label>
          <span>检查日期 *</span>
          <input
            type="date"
            value={form.examDate}
            onChange={(e) => set("examDate", e.target.value)}
          />
        </label>

        <label className={liveEval.flagged && form.thinnest !== "" ? "input-danger" : ""}>
          <span>角膜最薄点（μm）*</span>
          <input
            type="number"
            inputMode="decimal"
            value={form.thinnest}
            placeholder={`阈值 ${MIN_THICKNESS}`}
            onChange={(e) => set("thinnest", e.target.value)}
          />
        </label>
        <label>
          <span>Kmax（D）*</span>
          <input
            type="number"
            step="0.1"
            inputMode="decimal"
            value={form.kmax}
            placeholder="如 52.4"
            onChange={(e) => set("kmax", e.target.value)}
          />
        </label>
        <label className={liveEval.flagged && form.change6m !== "" ? "input-danger" : ""}>
          <span>半年变化量（μm）*</span>
          <input
            type="number"
            step="1"
            inputMode="decimal"
            value={form.change6m}
            placeholder={`阈值 ${MAX_CHANGE_6M}`}
            onChange={(e) => set("change6m", e.target.value)}
          />
        </label>
        <label>
          <span>治疗阶段 *</span>
          <select
            value={form.stage}
            onChange={(e) => set("stage", e.target.value as Stage)}
          >
            {STAGES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      </div>

      {numbersReady && liveEval.flagged && (
        <div className="alert alert-danger">
          <strong>触发转专科规则：</strong>
          {liveEval.reasons.join("；")}。输入将保留，状态置为「转专科待确认」，
          且不能占用交联设备。
        </div>
      )}

      {matched && (
        <div
          className={`alert ${
            matchedLocked ? "alert-info" : "alert-warn"
          }`}
        >
          {matchedLocked
            ? lockedChanged
              ? "该患者当天同眼检查已确认锁定：参数有变化，请填写变化原因，提交后将新建版本。"
              : "该患者当天同眼检查已确认锁定且参数一致，无需重复提交。"
            : "该患者当天同眼已有待确认记录，提交将直接更新该条（不新增）。"}
        </div>
      )}

      {lockedChanged && (
        <label className="reason-box">
          <span>复诊参数变化原因 *</span>
          <textarea
            rows={2}
            value={form.reason}
            placeholder="如：摘镜后复测 / 水肿消退后复查 / 设备更换"
            onChange={(e) => set("reason", e.target.value)}
          />
        </label>
      )}

      <div className="form-actions">
        <button
          type="button"
          className="ghost-btn"
          onClick={() => {
            setForm(initialForm());
            setFormKey((k) => k + 1);
          }}
        >
          清空
        </button>
        <button type="button" className="primary-action" onClick={submit}>
          保存检查记录
        </button>
      </div>
    </section>
  );
}
