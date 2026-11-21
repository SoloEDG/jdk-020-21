import { useMemo, useState } from "react";
import type { ConstructionMode, Shift } from "../../../shared/types";
import { PHASE_TEMPLATES, modeLabels } from "../model/phases";
import { previewPhase } from "../lib/preview";
import {
  activatePhase,
  cancelPlannedPhase,
  queuePhase,
} from "../model/commands";

export function ConstructionPanel({
  state,
  onChange,
}: {
  state: Shift;
  onChange: (s: Shift) => void;
}) {
  const [templateId, setTemplateId] = useState(PHASE_TEMPLATES[0].id);
  const [mode, setMode] = useState<ConstructionMode>("temporary");
  const cs = state.construction;
  const preview = useMemo(
    () => previewPhase(state, templateId, mode),
    [state, templateId, mode],
  );
  const active = cs.phases.find((p) => p.status === "active");

  return (
    <section className="construction-panel">
      <div className="section-heading">
        <div>
          <span className="eyebrow">PHASED CONSTRUCTION</span>
          <h2>
            分期施工
            <small>
              预算 {cs.budget} · 物料 {cs.materials}
            </small>
          </h2>
        </div>
        <span className="fleet-hint">预览为预计影响，确认后才占用资源</span>
      </div>

      {active && (
        <div className="active-construction" data-testid="active-phase">
          <div className="active-phase-head">
            <strong>{active.name}</strong>
            <span>{modeLabels[active.mode]}施工中</span>
          </div>
          <div className="phase-track">
            <i
              style={{
                width: `${Math.min(100, (active.elapsed / active.duration) * 100)}%`,
              }}
            />
          </div>
          <div className="phase-meta">
            <span>
              {Math.round(active.elapsed)}s / {active.duration}s
            </span>
            <span>
              已投入 {active.spentBudget} 预算 · {active.spentMaterials} 物料（不可回滚）
            </span>
          </div>
        </div>
      )}

      <div className="phase-queue">
        {cs.phases.map((p) => (
          <div
            key={p.id}
            className={`phase-row ${p.status}`}
            data-testid={`phase-${p.id}`}
          >
            <div>
              <strong>{p.name}</strong>
              <span>
                {modeLabels[p.mode]} ·{" "}
                {p.status === "planned"
                  ? `排队中 · ${p.duration}s`
                  : p.status === "active"
                    ? "施工中"
                    : "已完工 · 变更已生效"}
              </span>
              {p.dependsOn.length > 0 && (
                <em className="dep-tag">依赖 {p.dependsOn.join("、")}</em>
              )}
            </div>
            {p.status === "planned" && (
              <button
                className="phase-cancel"
                onClick={() => onChange(cancelPlannedPhase(state, p.id))}
              >
                撤销方案
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="template-picker">
        {PHASE_TEMPLATES.map((t) => {
          const depDone = t.dependsOn.every((dep) =>
            cs.phases.some(
              (p) => p.status === "done" && p.id.startsWith(`${dep}-`),
            ),
          );
          return (
            <button
              key={t.id}
              className={`template-card ${templateId === t.id ? "chosen" : ""}`}
              disabled={!depDone}
              title={depDone ? t.description : `需先完成 ${t.dependsOn.join("、")}`}
              onClick={() => setTemplateId(t.id)}
              data-testid={`template-${t.id}`}
            >
              <strong>{t.id}</strong>
              <span>{t.name}</span>
              {!depDone && <em>前置阶段未完工</em>}
            </button>
          );
        })}
      </div>

      <div className="mode-switch">
        {(["temporary", "full"] as ConstructionMode[]).map((m) => (
          <button
            key={m}
            className={mode === m ? "chosen" : ""}
            onClick={() => setMode(m)}
            data-testid={`mode-${m}`}
          >
            <strong>{modeLabels[m]}</strong>
            <span>
              {m === "temporary"
                ? "先建临时通道维持运行，绕远但工期长"
                : "整体封闭缩短工期，绕行与延误更大"}
            </span>
          </button>
        ))}
      </div>

      {preview && (
        <div className="impact-preview" data-testid="impact-preview">
          <div className="preview-head">
            <h3>预计影响（预览，尚未占用资源）</h3>
            <span className={`delay-chip ${preview.totalExpectedDelay > 120 ? "hot" : ""}`}>
              预计总延误 ≈ {preview.totalExpectedDelay}s
            </span>
          </div>
          <div className="preview-grid">
            {preview.standImpacts.map((si) => (
              <div
                key={si.standId}
                className={`impact-cell ${si.reachable ? "" : "cut"}`}
              >
                <strong>{si.standId}</strong>
                <span>
                  {si.reachable
                    ? si.detour && si.detour > 0
                      ? `绕行 +${si.detour}m`
                      : "路线不变"
                    : "封闭失联"}
                </span>
                <small>
                  {si.acceptsWide ? "可接纳宽体" : "仅窄体"}
                  {preview.newlyWide.includes(si.standId) && " · 新升级"}
                </small>
              </div>
            ))}
          </div>
          <div className="preview-flights">
            {preview.flightImpacts.map((fi) => (
              <div key={fi.flightId} className="flight-impact">
                <span>{fi.flightId}</span>
                <span className={fi.reachable ? "" : "cut-text"}>
                  {fi.reachable
                    ? fi.expectedDelay > 0
                      ? `预计延误 ${fi.expectedDelay}s`
                      : "基本无影响"
                    : fi.reason}
                </span>
              </div>
            ))}
          </div>
          <div className="preview-cost">
            <span>工期 {preview.phase.duration}s</span>
            <span>预算 {preview.phase.budgetCost}</span>
            <span>物料 {preview.phase.materialCost}</span>
            <span>
              余量 {preview.remainingBudget} / {preview.remainingMaterials}
            </span>
          </div>
          {preview.warnings.map((w) => (
            <p key={w} className="preview-warning">
              ⚠ {w}
            </p>
          ))}
          {preview.blocked.map((b) => (
            <p key={b} className="preview-blocked">
              ✕ {b}
            </p>
          ))}
        </div>
      )}

      <button
        className="primary full construct-confirm"
        data-testid="queue-phase"
        disabled={!preview || preview.blocked.length > 0 || !!active}
        onClick={() =>
          preview && onChange(queuePhase(state, templateId, mode))
        }
      >
        保存分期方案（排队） <span>↗</span>
      </button>
      <button
        className="secondary full construct-start"
        data-testid="activate-phase"
        disabled={
          !cs.phases.some((p) => p.status === "planned") || !!active
        }
        onClick={() => {
          const next = cs.phases.find((p) => p.status === "planned");
          if (next) onChange(activatePhase(state, next.id));
        }}
      >
        确认施工 · 立即封闭并占用资源
      </button>
    </section>
  );
}
