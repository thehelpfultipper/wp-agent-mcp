import type { ErrorCode } from "./errors";

export type PreflightCheckId = "dump_path" | "local_url" | "mysql_clients" | "db_reachable";

export type PreflightCheck = {
  id: PreflightCheckId;
  ok: boolean;
  message: string;
  remediation?: string;
  errorCode?: ErrorCode;
};

export type PreflightReport = {
  checks: PreflightCheck[];
};

export function isSandboxOrNetworkBlocked(stderr: string, stdout: string): boolean {
  const combined = `${stderr}\n${stdout}`.toLowerCase();
  return (
    combined.includes("operation not permitted") ||
    combined.includes("eperm") ||
    combined.includes("econnrefused") ||
    combined.includes("connection refused") ||
    combined.includes("no route to host") ||
    combined.includes("network is unreachable") ||
    (combined.includes("socket") && combined.includes("blocked"))
  );
}
