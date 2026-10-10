// The hand-curated reference drug table, parsed once with its schema.
import tableJson from "../../data/reference/drug_reference.json";
import { DrugTable } from "./schemas";

export const referenceTable = DrugTable.parse(tableJson);
