from pathlib import Path

import pytest

from jobcopilot.errors import DomainError
from jobcopilot.generation.latex import escape, render_and_compile


def test_escape_protects_latex_special_characters():
    assert escape(r"A&B_50% $ # {x} ~ ^") == r"A\&B\_50\% \$ \# \{x\} \textasciitilde{} \textasciicircum{}"


def test_missing_latex_engine_is_reported(tmp_path: Path, monkeypatch):
    template = tmp_path / "resume.tex"
    template.write_text("{{ full_name }}", encoding="utf-8")
    monkeypatch.setattr("jobcopilot.generation.latex.shutil.which", lambda _: None)

    with pytest.raises(DomainError, match="was not found"):
        render_and_compile(template, tmp_path, "resume-v1", {"full_name": "Asha"}, "pdflatex")
