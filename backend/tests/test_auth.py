from jobcopilot.auth import hash_password, verify_password


def test_password_hash_round_trip():
    encoded = hash_password("correct horse battery staple")

    assert encoded.startswith("pbkdf2_sha256$")
    assert verify_password("correct horse battery staple", encoded)
    assert not verify_password("wrong password", encoded)


def test_password_verification_rejects_invalid_hashes():
    assert not verify_password("password", None)
    assert not verify_password("password", "not-a-password-hash")
