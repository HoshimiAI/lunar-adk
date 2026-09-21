export interface Artifact {
  id: string;
  name: string;
  mimeType: string;
  data: unknown;
}

export interface ArtifactStore {
  save(artifact: Artifact): Promise<void>;
  get(id: string): Promise<Artifact | undefined>;
}
