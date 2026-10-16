"""Safe rendering and compilation of user-owned LaTeX templates."""

import shutil
import subprocess
from pathlib import Path

from jinja2 import Environment, StrictUndefined

from jobcopilot.errors import DomainError


def escape(value: object) -> str:
    """Escape text for LaTeX while preserving the generated template snippets."""
    text = str(value or "")
    replacements = {
        "\\": r"\textbackslash{}",
        "&": r"\&",
        "%": r"\%",
        "$": r"\$",
        "#": r"\#",
        "_": r"\_",
        "{": r"\{",
        "}": r"\}",
        "~": r"\textasciitilde{}",
        "^": r"\textasciicircum{}",
    }
    return "".join(replacements.get(char, char) for char in text)


def render_and_compile(template: Path, output_dir: Path, jobname: str, context: dict, engine: str) -> Path:
    if not template.exists() or not template.is_file():
        raise DomainError(f"JOBCOPILOT_LATEX_TEMPLATE {template} does not exist")
    executable = shutil.which(engine)
    if executable is None:
        raise DomainError(f"LaTeX engine {engine!r} was not found on PATH")

    environment = Environment(undefined=StrictUndefined, autoescape=False, keep_trailing_newline=True)
    try:
        source = environment.from_string(template.read_text(encoding="utf-8")).render(**context)
    except Exception as exc:
        raise DomainError(f"could not render LaTeX template {template}: {exc}") from exc

    tex_path = output_dir / f"{jobname}.tex"
    tex_path.write_text(source, encoding="utf-8")
    try:
        result = subprocess.run(
            [
                executable,
                "-interaction=nonstopmode",
                "-halt-on-error",
                "-output-directory",
                str(output_dir),
                "-jobname",
                jobname,
                str(tex_path),
            ],
            cwd=output_dir,
            capture_output=True,
            text=True,
            check=False,
        )
    except OSError as exc:
        raise DomainError(f"could not start LaTeX engine {engine!r}: {exc}") from exc
    if result.returncode != 0:
        detail = (result.stdout + "\n" + result.stderr).strip()[-2000:]
        raise DomainError(f"LaTeX compilation failed for {template}: {detail}")

    pdf = output_dir / f"{jobname}.pdf"
    if not pdf.exists():
        raise DomainError(f"LaTeX engine completed without producing {pdf.name}")
    for suffix in (".aux", ".log", ".out", ".fls", ".fdb_latexmk", ".synctex.gz"):
        generated = output_dir / f"{jobname}{suffix}"
        if generated.exists():
            generated.unlink()
    return pdf
