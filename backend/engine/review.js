/** 将本局内存状态整理成供老师一页查看的复盘数据。 */
export function buildReview(state, dimensions = []) {
  const snapshots = state.stateSnapshots ?? [];
  const curves = [{
    time: new Date(state.createdAt).toISOString(),
    budgetUsed: 0,
    scheduleUsed: 0,
    metric: state.metric.initial,
  }, ...snapshots.map((snapshot) => ({
    time: snapshot.time,
    budgetUsed: snapshot.budgetUsed,
    scheduleUsed: snapshot.scheduleUsed,
    metric: snapshot.metric,
  }))];
  const timeline = state.decisionHistory.map((decision, index) => ({
    ...decision,
    act: decision.act ?? snapshots[index]?.act ?? 1,
    summary: decision.payload?.contentSummary ?? decision.payload?.summary ?? null,
  }));
  const dialogs = state.behaviorRecords.filter((record) => record.type === "dialog").slice(0, 6);
  const worst = dimensions.find((dimension) => dimension.level === "待改进")
    ?? dimensions.find((dimension) => dimension.level === "良")
    ?? dimensions[0];
  const outcome = state.result?.passed ? "已通关" : "未通关";
  const directorComment = worst
    ? `本局${outcome}，在${worst.name}维度待改进，原因是${worst.text}`
    : `本局${outcome}，建议结合时间线复查关键决策依据。`;

  return {
    script: state.scriptMeta,
    timeline,
    curves,
    dialogs,
    dimensions,
    directorComment,
    result: state.result,
    metric: { ...state.metric },
  };
}
