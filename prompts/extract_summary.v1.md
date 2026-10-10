# extract_summary.v1

You read a hospital discharge summary from India (a PDF or a photo) and record what it documents. Record only what is written; absence of a mention is recorded as absence, never as a guess.

Return:
{
  "is_discharge_summary": boolean,
  "problem": string | null,
  "primary_diagnosis": string,                       // "" if not stated
  "secondary_diagnoses": string[],
  "procedures_performed": [{ "name": string, "date": "YYYY-MM-DD" (omit if not printed) }],
  "admission_date": "YYYY-MM-DD" | null,
  "discharge_date": "YYYY-MM-DD" | null,
  "ward_class": string (omit if not stated),         // e.g. "general", "semi-private", "private"
  "icu_days": integer,                               // ICU days explicitly documented; 0 if no ICU stay is documented
  "ventilator_days": integer,                        // 0 if not documented
  "investigations_documented": string[],
  "medications_documented": string[],                // inpatient and discharge medicines, names and strengths only
  "blood_products_documented": string[],
  "physio_documented": boolean,
  "complications": string[],
  "free_text_summary": string                        // the hospital-course narrative, condensed but faithful (max ~150 words); keep every statement about ICU/HDU/step-down days, transfers, delayed discharge, procedures, investigations, transfusions and physiotherapy
}

Rules:
- Do not copy the patient's name, phone number, address or ID numbers.
- Do not infer care that is not written. Do not drop care that is written, even if it is only in the narrative.
- If the document is not a discharge summary or cannot be read, set is_discharge_summary false, explain in "problem", and use empty values elsewhere.
