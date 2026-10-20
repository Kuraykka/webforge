import type { ApiClient } from "../../lib/api";

export type EnvEnvironment = "desarrollo" | "produccion";

export const ENVIRONMENT_LABELS: Record<EnvEnvironment, string> = {
  desarrollo: "Desarrollo",
  produccion: "Producción"
};

export const MAX_ENV_KEY_CHARS = 60;
export const MAX_ENV_VALUE_CHARS = 8192;

/** Lo que se ve en la lista: el valor solo llega con una lectura explícita. */
export interface EnvVariable {
  id: string;
  projectId: string;
  environment: EnvEnvironment;
  key: string;
  bytes: number;
  updatedAt: string;
}

export interface EnvSecret extends EnvVariable {
  value: string;
}

export interface EnvStore {
  list(projectId: string, environment: EnvEnvironment): Promise<EnvVariable[]>;
  save(projectId: string, environment: EnvEnvironment, key: string, value: string): Promise<EnvVariable>;
  reveal(projectId: string, variableId: string): Promise<EnvSecret>;
  remove(projectId: string, variableId: string): Promise<void>;
}

interface ListPayload {
  variables: EnvVariable[];
}

interface VariablePayload {
  variable: EnvVariable;
}

interface SecretPayload {
  variable: EnvSecret;
}

function ref(projectId: string, suffix = ""): string {
  return `/api/projects/${encodeURIComponent(projectId)}/env${suffix}`;
}

function of(projectId: string, variableId: string): string {
  return ref(projectId, `/${encodeURIComponent(variableId)}`);
}

export class HttpEnvStore implements EnvStore {
  constructor(private readonly api: ApiClient) {}

  async list(projectId: string, environment: EnvEnvironment): Promise<EnvVariable[]> {
    const query = `?environment=${encodeURIComponent(environment)}`;
    return (await this.api.get<ListPayload>(ref(projectId, query))).variables;
  }

  async save(projectId: string, environment: EnvEnvironment, key: string, value: string): Promise<EnvVariable> {
    const payload = await this.api.put<VariablePayload>(ref(projectId), { environment, key, value });
    return payload.variable;
  }

  async reveal(projectId: string, variableId: string): Promise<EnvSecret> {
    return (await this.api.post<SecretPayload>(`${of(projectId, variableId)}/reveal`, {})).variable;
  }

  async remove(projectId: string, variableId: string): Promise<void> {
    await this.api.remove(of(projectId, variableId));
  }
}
