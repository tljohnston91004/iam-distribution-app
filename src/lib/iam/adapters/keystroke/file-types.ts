/** Keystroke / RSE multi-file upload types (adapter — outside IAM Core). */

export type IamKeystrokeFileType =
  | "inventory_position"
  | "demand_replenishment"
  | "demand_classification"
  | "inventory_classification"
  | "unknown";

export type DemandVariant = "matrix" | "standard" | "unspecified";

export interface ChecklistSlot {
  key: string;
  label: string;
  required: boolean;
  fileType: IamKeystrokeFileType;
  variant?: DemandVariant;
  status: "ok" | "missing" | "optional_missing";
  filenames: string[];
  rowCount: number;
}

export function detectDemandVariant(filename: string): DemandVariant {
  const lower = filename.toLowerCase();
  if (/matrix/.test(lower)) return "matrix";
  if (/standard/.test(lower)) return "standard";
  return "unspecified";
}

export function resolveKeystrokeFileType(
  filename: string,
  headers: string[]
): { fileType: IamKeystrokeFileType; variant: DemandVariant | null } {
  const f = filename.toLowerCase().replace(/\\/g, "/");
  const h = headers.join(" ").toLowerCase();
  const variant = detectDemandVariant(filename);

  // True Demand Classification Standard / Matrix (RSE output; optional when standalone).
  if (/truedemandclassification|true.?demand.?classification/.test(f)) {
    return { fileType: "demand_classification", variant };
  }

  // Inventory Classification (RSE or manual).
  if (
    /inventoryclassification|inventory.?classification|inv.?class/.test(f) ||
    (/classification|abc class|inventory class/.test(h) &&
      /on-hand|on hand|available qoh|last cost|stock #/.test(h) === false &&
      /qty sold|units sold/.test(h) === false)
  ) {
    return { fileType: "inventory_classification", variant: null };
  }

  if (
    /truedemandreplen|truedemandreplish|true.?demand.?replen/.test(f) ||
    (/qty sold|units sold/.test(h) && !/classification/.test(f))
  ) {
    return { fileType: "demand_replenishment", variant };
  }

  if (
    /scbsrse3|inventoryposition|inventory.?position/.test(f) ||
    /on-hand|on hand qty|available qoh|last cost/.test(h)
  ) {
    return { fileType: "inventory_position", variant: null };
  }

  if (/qty sold|units sold|total sale/.test(h)) {
    return { fileType: "demand_replenishment", variant };
  }

  return { fileType: "unknown", variant: null };
}

export function buildChecklist(
  batches: {
    fileType: string;
    demandVariant: string | null;
    originalFilename: string;
    rowCount: number;
  }[]
): { slots: ChecklistSlot[]; readyToMerge: boolean; warnings: string[] } {
  const inv = batches.filter((b) => b.fileType === "inventory_position");
  const replMatrix = batches.filter(
    (b) => b.fileType === "demand_replenishment" && b.demandVariant === "matrix"
  );
  const replStandard = batches.filter(
    (b) => b.fileType === "demand_replenishment" && b.demandVariant === "standard"
  );
  const replOther = batches.filter(
    (b) =>
      b.fileType === "demand_replenishment" &&
      b.demandVariant !== "matrix" &&
      b.demandVariant !== "standard"
  );
  const classDemand = batches.filter((b) => b.fileType === "demand_classification");
  const classInv = batches.filter((b) => b.fileType === "inventory_classification");

  const sumRows = (list: typeof batches) => list.reduce((n, b) => n + b.rowCount, 0);
  const names = (list: typeof batches) => list.map((b) => b.originalFilename);

  const slots: ChecklistSlot[] = [
    {
      key: "inventory",
      label: "Inventory (SCBSRSE3 / INVENTORYPOSITION)",
      required: true,
      fileType: "inventory_position",
      status: inv.length ? "ok" : "missing",
      filenames: names(inv),
      rowCount: sumRows(inv),
    },
    {
      key: "replenishment_standard",
      label: "13-week Demand — Standard",
      required: false,
      fileType: "demand_replenishment",
      variant: "standard",
      status: replStandard.length ? "ok" : "optional_missing",
      filenames: names(replStandard),
      rowCount: sumRows(replStandard),
    },
    {
      key: "replenishment_matrix",
      label: "13-week Demand — Matrix",
      required: false,
      fileType: "demand_replenishment",
      variant: "matrix",
      status: replMatrix.length ? "ok" : "optional_missing",
      filenames: names(replMatrix),
      rowCount: sumRows(replMatrix),
    },
    {
      key: "classification_standard",
      label: "True Demand Classification — Standard (optional)",
      required: false,
      fileType: "demand_classification",
      variant: "standard",
      status: classDemand.some((b) => b.demandVariant === "standard")
        ? "ok"
        : "optional_missing",
      filenames: names(classDemand.filter((b) => b.demandVariant === "standard")),
      rowCount: sumRows(classDemand.filter((b) => b.demandVariant === "standard")),
    },
    {
      key: "classification_matrix",
      label: "True Demand Classification — Matrix (optional)",
      required: false,
      fileType: "demand_classification",
      variant: "matrix",
      status: classDemand.some((b) => b.demandVariant === "matrix")
        ? "ok"
        : "optional_missing",
      filenames: names(classDemand.filter((b) => b.demandVariant === "matrix")),
      rowCount: sumRows(classDemand.filter((b) => b.demandVariant === "matrix")),
    },
    {
      key: "inventory_classification",
      label: "Inventory Classification (optional — RSE or manual)",
      required: false,
      fileType: "inventory_classification",
      status: classInv.length ? "ok" : "optional_missing",
      filenames: names(classInv),
      rowCount: sumRows(classInv),
    },
  ];

  if (replOther.length) {
    slots.push({
      key: "replenishment_other",
      label: "13-week Demand — Other",
      required: false,
      fileType: "demand_replenishment",
      variant: "unspecified",
      status: "ok",
      filenames: names(replOther),
      rowCount: sumRows(replOther),
    });
  }

  const classOther = classDemand.filter(
    (b) => b.demandVariant !== "matrix" && b.demandVariant !== "standard"
  );
  if (classOther.length) {
    slots.push({
      key: "classification_other",
      label: "True Demand Classification — Other",
      required: false,
      fileType: "demand_classification",
      status: "ok",
      filenames: names(classOther),
      rowCount: sumRows(classOther),
    });
  }

  const hasDemand = replMatrix.length + replStandard.length + replOther.length > 0;
  const readyToMerge = inv.length > 0 && hasDemand;

  const warnings: string[] = [];
  if (inv.length === 0) warnings.push("Upload inventory (SCBSRSE3 or INVENTORYPOSITION) before merge.");
  if (!hasDemand) warnings.push("Upload at least one 13-week True Demand Replenishment file.");
  if (replMatrix.length && replStandard.length) {
    warnings.push(
      "Matrix + Standard both staged. SKUs on both files are treated as matrix parent schemes and excluded on merge (RLC/RSE rule)."
    );
  }
  if (classDemand.length || classInv.length) {
    warnings.push(
      "Classification reports are optional when standalone; when present they enrich inventory class/vendor dimensions (RSE outputs consumed, not recalculated)."
    );
  }
  if (replMatrix.length && inv.some((b) => /inventoryposition/i.test(b.originalFilename))) {
    warnings.push(
      "INVENTORYPOSITION is standard-grain; prefer SCBSRSE3 when Matrix demand is used (variant QOH)."
    );
  }

  return { slots, readyToMerge, warnings };
}
