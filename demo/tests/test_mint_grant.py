"""The operator's grant-minting tool, and how it takes the host's key material.

The host's public key is published (it is the grant's ``grantor_did``), and the
private key is one SHA-256 of whatever the operator typed. A memorable passphrase
can therefore be guessed offline against the published key, so the tool refuses
one unless told the operator knows. It never takes the material on the command
line, where it lands in shell history and the process list.
"""

from __future__ import annotations

import hashlib
import importlib.util
import io
import json
from pathlib import Path

import pytest
from sm_arp import Identity

TOOL = Path(__file__).resolve().parent.parent / "tools" / "mint_grant.py"
AGENT = "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK"
STRONG = "a3" * 32
WEAK = "correct horse"


@pytest.fixture
def mint(monkeypatch, tmp_path):
    spec = importlib.util.spec_from_file_location("mint_grant", TOOL)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    monkeypatch.setenv("CONCIERGE_AUTHORITY", str(tmp_path / "authority"))
    monkeypatch.setenv("AGENT_DID", AGENT)
    monkeypatch.delenv("HOST_SEED", raising=False)
    monkeypatch.delenv("HOST_SEED_FILE", raising=False)
    return module


def _grantor(tmp_path) -> str:
    return json.loads((tmp_path / "authority" / "grant.json").read_text())["grantor_did"]


def _legacy_did(material: str) -> str:
    """How the reference deployment's host key has always been derived."""
    return Identity.from_seed(hashlib.sha256(material.encode("utf-8")).digest()).did


def test_the_existing_derivation_is_unchanged(mint, tmp_path):
    """The live grant's host key must stay derivable from the same material."""
    seed_file = tmp_path / "host.seed"
    seed_file.write_text(STRONG + "\n")
    assert mint.main(["--seed-file", str(seed_file)]) == 0
    assert _grantor(tmp_path) == _legacy_did(STRONG)


def test_the_material_can_come_from_stdin(mint, tmp_path, monkeypatch):
    monkeypatch.setattr("sys.stdin", io.StringIO(STRONG + "\n"))
    assert mint.main(["--seed-file", "-"]) == 0
    assert _grantor(tmp_path) == _legacy_did(STRONG)


def test_the_material_can_be_typed_at_a_prompt(mint, tmp_path, monkeypatch):
    monkeypatch.setattr(mint.getpass, "getpass", lambda *_a, **_k: STRONG)
    assert mint.main(["--prompt"]) == 0
    assert _grantor(tmp_path) == _legacy_did(STRONG)


def test_the_material_file_can_be_named_in_the_environment(mint, tmp_path, monkeypatch):
    seed_file = tmp_path / "host.seed"
    seed_file.write_text(STRONG)
    monkeypatch.setenv("HOST_SEED_FILE", str(seed_file))
    assert mint.main([]) == 0
    assert _grantor(tmp_path) == _legacy_did(STRONG)


def test_host_seed_in_the_environment_still_works_but_warns(mint, tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("HOST_SEED", STRONG)
    assert mint.main([]) == 0
    assert _grantor(tmp_path) == _legacy_did(STRONG)
    assert "HOST_SEED" in capsys.readouterr().err


def test_the_material_is_never_accepted_on_the_command_line(mint):
    with pytest.raises(SystemExit) as exc:
        mint.main(["--seed", STRONG])
    assert exc.value.code == 2


def test_a_weak_passphrase_is_refused_and_nothing_is_written(mint, tmp_path, capsys):
    seed_file = tmp_path / "host.seed"
    seed_file.write_text(WEAK)
    assert mint.main(["--seed-file", str(seed_file)]) == 2
    assert not (tmp_path / "authority" / "grant.json").exists()
    assert "--allow-weak" in capsys.readouterr().err


@pytest.mark.parametrize("material", ["a" * 63, "g" * 64, "x" * 40, "0123456789abcdef" * 3])
def test_anything_short_of_32_hex_bytes_is_weak(mint, material):
    assert not mint.is_strong(material)


@pytest.mark.parametrize("material", [STRONG, STRONG.upper(), "ab" * 48])
def test_32_or_more_random_hex_bytes_is_strong(mint, material):
    assert mint.is_strong(material)


def test_allow_weak_keeps_an_existing_weak_host_key_usable(mint, tmp_path, capsys):
    """The escape for re-minting under a host key that predates the check,
    until it is rotated. Same derivation, and it says so."""
    seed_file = tmp_path / "host.seed"
    seed_file.write_text(WEAK)
    assert mint.main(["--seed-file", str(seed_file), "--allow-weak"]) == 0
    assert _grantor(tmp_path) == _legacy_did(WEAK)
    assert "weak" in capsys.readouterr().err.lower()


def test_an_empty_seed_file_is_an_error_not_a_disposable_key(mint, tmp_path):
    seed_file = tmp_path / "host.seed"
    seed_file.write_text("\n")
    assert mint.main(["--seed-file", str(seed_file)]) == 2
    assert not (tmp_path / "authority" / "grant.json").exists()


def test_a_missing_seed_file_is_an_error(mint, tmp_path):
    assert mint.main(["--seed-file", str(tmp_path / "nope")]) == 2


def test_no_material_at_all_still_mints_a_disposable_host(mint, tmp_path, capsys):
    assert mint.main([]) == 0
    assert _grantor(tmp_path).startswith("did:key:z")
    assert "discarded" in capsys.readouterr().out


def test_generate_prints_strong_material(mint, capsys):
    assert mint.main(["--generate-seed"]) == 0
    material = capsys.readouterr().out.strip()
    assert mint.is_strong(material)
