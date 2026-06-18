/**
 * 新建项目分步向导（M3 Dialog stepper）。强化「新建项目」交互：
 *   步骤 1 命名 → 步骤 2 预览创建后三步（上传材料 / 选交付模式 / 启动），确认即创建并进入项目。
 * 交付模式仅作引导预览（真正选择在项目详情页启动任务时）。
 */
import { useEffect, useState } from "react";
import { Dialog, Chip } from "./M3.tsx";
import { Button, TextInput } from "./Brutalist.tsx";

const MODES = [
  { name: "决策", hint: "可执行选项 + 取舍标准" },
  { name: "培训", hint: "结构化教学材料" },
  { name: "落地", hint: "实施路径与里程碑" },
  { name: "调研", hint: "行业/对象深度研究" },
  { name: "诊断", hint: "问题定位 + 根因 + 优先级" },
];

export function NewProjectWizard({ open, onClose, onCreate, pending }: {
  open: boolean;
  onClose: () => void;
  onCreate: (name: string) => void;
  pending: boolean;
}) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [modePreview, setModePreview] = useState<string | null>(null);

  useEffect(() => {
    if (open) { setStep(0); setName(""); setModePreview(null); }
  }, [open]);

  const canNext = name.trim().length > 0;
  const title = step === 0 ? "新建项目 · 命名" : "新建项目 · 接下来";

  return (
    <Dialog
      open={open}
      title={<span>{title} <span style={{ color: "var(--md-on-surface-variant)", fontSize: 13, fontWeight: 400 }}>（{step + 1}/2）</span></span>}
      onClose={onClose}
      actions={
        step === 0 ? (
          <>
            <Button variant="secondary" onClick={onClose}>取消</Button>
            <Button disabled={!canNext} onClick={() => setStep(1)}>下一步 →</Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={() => setStep(0)}>← 上一步</Button>
            <Button disabled={pending || !canNext} onClick={() => onCreate(name.trim())}>{pending ? "创建中…" : "创建并进入"}</Button>
          </>
        )
      }
    >
      {step === 0 ? (
        <div className="space-y-3">
          <p>项目是一条从输入材料到交付物的生产线。建议项目名包含<strong>客户 / 场景 / 交付目标</strong>。</p>
          <TextInput autoFocus placeholder="例如：物业 AI 战略报告" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && canNext) setStep(1); }} />
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <div className="mb-1 font-semibold" style={{ color: "var(--md-on-surface)" }}>「{name.trim()}」创建后三步：</div>
            <ol style={{ paddingLeft: 18, listStyle: "decimal" }} className="space-y-1">
              <li>上传客户参考材料（输入物）</li>
              <li>选择交付模式并启动任务</li>
              <li>在监控区跟踪进度、审批、导出产物</li>
            </ol>
          </div>
          <div>
            <div className="mb-2 font-[var(--boule-mono)] text-[11px] uppercase tracking-[0.1em]" style={{ color: "var(--md-on-surface-variant)" }}>交付模式（创建后在详情页选）</div>
            <div className="flex flex-wrap gap-2">
              {MODES.map((m) => (
                <Chip key={m.name} label={m.name} selected={modePreview === m.name} onClick={() => setModePreview(modePreview === m.name ? null : m.name)} />
              ))}
            </div>
            {modePreview && <p className="mt-2 text-[13px]" style={{ color: "var(--md-on-surface-variant)" }}>{MODES.find((m) => m.name === modePreview)?.hint}</p>}
          </div>
        </div>
      )}
    </Dialog>
  );
}
