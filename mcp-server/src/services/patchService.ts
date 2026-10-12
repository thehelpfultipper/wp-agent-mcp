import { AppError } from "../errors";

export type ApplyPatchInput = {
  wpRoot?: string;
  patch?: string;
};

export type PatchService = {
  applyPatch: (input: ApplyPatchInput) => Record<string, unknown>;
};

export function createPatchServiceNotImplemented(): PatchService {
  return {
    applyPatch: () => {
      throw new AppError(
        "INTERNAL_ERROR",
        "Patch service is not yet migrated behind the service layer.",
        501
      );
    }
  };
}

