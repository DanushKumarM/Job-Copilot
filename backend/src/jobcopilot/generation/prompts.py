"""Prompt templates. Bump PROMPT_VERSION on any change; it is recorded on every document and call."""

PROMPT_VERSION = "gen-v1"

SYSTEM = """You write job-application content for one candidate.
Hard rules:
- Use ONLY the facts provided. Every claim must list the IDs of the facts that support it in fact_ids.
- Never mention a skill, tool, employer, number or result that is not in a cited fact.
- If a requirement has no supporting fact, do not write about it. Gaps are acceptable; invention is not.
- Write concise, specific, first-person-implied resume language (no "I"). No filler adjectives.
Return JSON matching the schema."""

KIND_INSTRUCTIONS = {
    "resume_bullets": "Write 4-8 resume bullets tailored to this job, most relevant first. One claim per bullet.",
    "summary": "Write a 2-3 sentence professional summary tailored to this job. Each sentence is one claim.",
    "screening_answers": "Answer the screening questions below. Each answer is one claim.",
    "cover_letter": "Write a short cover letter of 3 paragraphs. Each sentence that states a fact is one claim.",
}


def build_prompt(
    kind: str,
    job_title: str,
    company: str,
    requirements: list[tuple[str, str]],
    gaps: list[str],
    facts: list[tuple[str, str]],
    previous_issues: list[str] | None = None,
) -> str:
    lines = [f"Job: {job_title} at {company}", "", "Requirements (importance: statement):"]
    lines += [f"- {importance}: {statement}" for importance, statement in requirements]
    if gaps:
        lines += ["", "Requirements with NO supporting fact (do not claim these):"] + [f"- {g}" for g in gaps]
    lines += ["", "Verified facts (id: statement):"] + [f"- {fid}: {statement}" for fid, statement in facts]
    lines += ["", "Task: " + KIND_INSTRUCTIONS[kind]]
    if previous_issues:
        lines += ["", "Your previous attempt was rejected by the validator. Fix these problems:"]
        lines += [f"- {issue}" for issue in previous_issues]
    return "\n".join(lines)


SCREENING_SYSTEM = """You answer screening questions for a job application.
Hard rules:
- Ground every answer in the candidate's verified facts.
- Never invent skills, numbers, or experiences not supported by the facts.
- Keep each answer to 2-3 sentences, direct, professional, and relevant to the question.
- If no fact supports an answer, state honestly that you do not have direct experience with that specific requirement.
Return JSON matching the schema."""


def build_screening_prompt(
    job_title: str,
    company: str,
    requirements: list[tuple[str, str]],
    facts: list[tuple[str, str]],
    questions: list[str],
) -> str:
    lines = [f"Job: {job_title} at {company}", "", "Requirements (importance: statement):"]
    lines += [f"- {importance}: {statement}" for importance, statement in requirements]
    lines += ["", "Verified facts (id: statement):"] + [f"- {fid}: {statement}" for fid, statement in facts]
    lines += ["", "Screening questions to answer:"]
    lines += [f"- {q}" for q in questions]
    lines += ["", "Task: Provide a concise, 2-3 sentence fact-grounded answer for each question."]
    return "\n".join(lines)
