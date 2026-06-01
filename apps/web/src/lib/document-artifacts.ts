export interface ArtifactVersionRef {
  id: string;
  phase: string;
  type: string;
  version: number;
}

export function latestForArtifact<T extends ArtifactVersionRef>(artifacts: readonly T[], artifact: ArtifactVersionRef): T | undefined {
  return artifacts
    .filter((a) => a.phase === artifact.phase && a.type === artifact.type)
    .sort((a, b) => b.version - a.version)[0];
}

export function isHistoryVersion(artifacts: readonly ArtifactVersionRef[], artifact: ArtifactVersionRef): boolean {
  const latest = latestForArtifact(artifacts, artifact);
  return Boolean(latest && artifact.version < latest.version);
}
