"""Security, retention, and lifecycle contract for room table talk."""

from __future__ import annotations

import asyncio
import os
import pathlib
import sys

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
os.environ.pop("KV_REST_API_URL", None)
os.environ.pop("UPSTASH_REDIS_REST_URL", None)

import main  # noqa: E402


class FakeClock:
    def __init__(self, start: float = 1_700_000_000.0):
        self.now = start

    def time(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


@pytest.fixture
def clock(monkeypatch):
    fake = FakeClock()
    monkeypatch.setattr(main, "time", fake)
    return fake


@pytest.fixture
def client():
    main.redis = main.devstore.LocalStore()
    with TestClient(main.asgi_app) as test_client:
        yield test_client


def create_room(client: TestClient, host_name: str = "Host") -> dict:
    response = client.post(
        "/api/rooms",
        json={
            "name": "Chat table",
            "hostName": host_name,
            "startingChips": 1000,
            "smallBlind": 5,
            "bigBlind": 10,
            "password": "secret",
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


def join(client: TestClient, room_id: str, name: str) -> dict:
    response = client.post(
        f"/api/rooms/{room_id}/join",
        json={"name": name, "password": "secret"},
    )
    assert response.status_code == 200, response.text
    return response.json()


def watch(client: TestClient, room_id: str) -> dict:
    response = client.post(
        f"/api/rooms/{room_id}/watch", json={"password": "secret"}
    )
    assert response.status_code == 200, response.text
    return response.json()


def auth(session: dict) -> dict[str, str]:
    return {main.PLAYER_TOKEN_HEADER: session["token"]}


def send(
    client: TestClient,
    room_id: str,
    session: dict,
    text: str,
    request_id: str,
):
    return client.post(
        f"/api/rooms/{room_id}/chat",
        headers=auth(session),
        json={"text": text, "requestId": request_id},
    )


def test_author_identity_comes_only_from_the_player_capability(client, clock):
    host = create_room(client, host_name="Real Host")
    guest = join(client, host["roomId"], "Guest")

    response = send(client, host["roomId"], guest, "River?", "guest-1")
    assert response.status_code == 200, response.text
    message = response.json()["messages"][0]
    assert message == {
        "id": message["id"],
        "authorName": "Guest",
        "text": "River?",
        "createdAt": 1_700_000_000_000,
        "isMine": True,
    }

    # Spoof-shaped fields are not part of the contract and are rejected. A
    # client cannot even offer a display name or seat for the server to trust.
    spoof = client.post(
        f"/api/rooms/{host['roomId']}/chat",
        headers=auth(guest),
        json={
            "text": "I am definitely the host",
            "requestId": "guest-2",
            "playerId": host["playerId"],
            "authorName": "Real Host",
        },
    )
    assert spoof.status_code == 422

    seen_by_host = client.get(
        f"/api/rooms/{host['roomId']}/chat", headers=auth(host)
    ).json()["messages"][0]
    assert seen_by_host["authorName"] == "Guest"
    assert seen_by_host["isMine"] is False


def test_spectators_can_read_but_cannot_send_or_receive_private_fields(client, clock):
    host = create_room(client)
    room_id = host["roomId"]
    assert send(client, room_id, host, "Welcome", "host-1").status_code == 200
    spectator = watch(client, room_id)

    response = client.get(f"/api/rooms/{room_id}/chat", headers=auth(spectator))
    assert response.status_code == 200, response.text
    assert response.headers["Cache-Control"] == "private, no-store"
    assert response.headers["Vary"] == main.PLAYER_TOKEN_HEADER
    body = response.json()
    assert set(body) == {"messages", "canSend", "serverTime"}
    assert body["canSend"] is False
    assert set(body["messages"][0]) == {
        "id",
        "authorName",
        "text",
        "createdAt",
        "isMine",
    }
    assert body["messages"][0]["isMine"] is False
    serialized = response.text
    assert host["playerId"] not in serialized
    assert host["token"] not in serialized
    assert "stateB64" not in serialized

    refused = send(client, room_id, spectator, "Let me in", "watch-1")
    assert refused.status_code == 403
    assert "seated" in refused.json()["detail"].lower()
    assert client.get(f"/api/rooms/{room_id}/chat").status_code == 403


def test_a_removed_seat_cannot_keep_sending(client, clock):
    host = create_room(client)
    guest = join(client, host["roomId"], "Guest")
    kicked = client.post(
        f"/api/rooms/{host['roomId']}/kick",
        headers=auth(host),
        json={"playerId": host["playerId"], "targetId": guest["playerId"]},
    )
    assert kicked.status_code == 200, kicked.text

    response = send(client, host["roomId"], guest, "Still here", "after-kick")
    assert response.status_code == 410


def test_messages_are_normalized_bounded_and_server_timestamped(client, clock):
    host = create_room(client)
    room_id = host["roomId"]

    blank = send(client, room_id, host, " \n ", "blank")
    assert blank.status_code == 400
    too_long = send(client, room_id, host, "x" * 281, "long")
    assert too_long.status_code == 422
    control = send(client, room_id, host, "hello\u0000there", "control")
    assert control.status_code == 400

    response = send(client, room_id, host, "  one\r\ntwo  ", "valid")
    assert response.status_code == 200, response.text
    message = response.json()["messages"][0]
    assert message["text"] == "one\ntwo"
    assert message["createdAt"] == 1_700_000_000_000
    assert isinstance(message["id"], str) and len(message["id"]) >= 12


def test_retry_returns_the_same_stable_message(client, clock):
    host = create_room(client)
    first = send(client, host["roomId"], host, "Once", "same-intention")
    second = send(client, host["roomId"], host, "Changed retry", "same-intention")
    assert first.status_code == second.status_code == 200
    assert second.json()["messages"] == first.json()["messages"]
    assert len(second.json()["messages"]) == 1


def test_chat_is_stored_outside_the_serialized_room_blob(client, clock):
    host = create_room(client)
    room_id = host["roomId"]
    before = client.portal.call(main.redis.get, main._room_key(room_id))

    assert send(client, room_id, host, "Separate document", "separate-1").status_code == 200

    after = client.portal.call(main.redis.get, main._room_key(room_id))
    raw_chat = client.portal.call(main.redis.get, main._chat_key(room_id))
    assert after == before, "sending chat must not rewrite the PokerKit room value"
    assert raw_chat is not None and "Separate document" in raw_chat
    assert "stateB64" not in raw_chat


def test_a_new_room_never_inherits_chat_from_a_reused_code(
    client, clock, monkeypatch
):
    first = create_room(client, host_name="First host")
    assert send(
        client, first["roomId"], first, "Private to the first room", "first-room"
    ).status_code == 200

    # Force the rare collision so the privacy property is executable rather
    # than depending on the size of the random room-code space.
    monkeypatch.setattr(main, "_new_id", lambda: first["roomId"])
    replacement = create_room(client, host_name="Replacement host")
    response = client.get(
        f"/api/rooms/{replacement['roomId']}/chat", headers=auth(replacement)
    )
    assert response.status_code == 200
    assert response.json()["messages"] == []
    assert "Private to the first room" not in response.text


def test_concurrent_sends_are_serialized_without_losing_either_message(client, clock):
    host = create_room(client)
    guest = join(client, host["roomId"], "Guest")

    async def send_together():
        return await asyncio.gather(
            main.send_chat(
                host["roomId"],
                main.ChatSendBody(text="From host", requestId="race-host"),
                x_player_token=host["token"],
            ),
            main.send_chat(
                host["roomId"],
                main.ChatSendBody(text="From guest", requestId="race-guest"),
                x_player_token=guest["token"],
            ),
        )

    client.portal.call(send_together)
    messages = client.get(
        f"/api/rooms/{host['roomId']}/chat", headers=auth(host)
    ).json()["messages"]
    assert {message["text"] for message in messages} == {"From host", "From guest"}
    assert len({message["id"] for message in messages}) == 2


def test_rate_limit_handles_bursts_and_the_rolling_minute(client, clock):
    host = create_room(client)
    room_id = host["roomId"]

    for index in range(main.CHAT_BURST_MESSAGES):
        assert send(client, room_id, host, f"burst {index}", f"b-{index}").status_code == 200
    blocked = send(client, room_id, host, "too fast", "burst-blocked")
    assert blocked.status_code == 429
    assert blocked.headers["Retry-After"] == str(main.CHAT_BURST_SECONDS)

    clock.advance(main.CHAT_BURST_SECONDS + 0.1)
    assert send(client, room_id, host, "after pause", "after-burst").status_code == 200

    # Start fresh, then place four messages in each ten-second band. No band
    # reaches the burst cap, but twenty messages still fill the minute window.
    main.redis = main.devstore.LocalStore()
    host = create_room(client)
    room_id = host["roomId"]
    for band in range(5):
        for item in range(4):
            response = send(
                client,
                room_id,
                host,
                f"minute {band}-{item}",
                f"m-{band}-{item}",
            )
            assert response.status_code == 200, response.text
        if band < 4:
            clock.advance(main.CHAT_BURST_SECONDS + 0.1)
    minute_blocked = send(client, room_id, host, "twenty one", "minute-blocked")
    assert minute_blocked.status_code == 429
    assert 1 <= int(minute_blocked.headers["Retry-After"]) <= main.CHAT_WINDOW_SECONDS


def test_only_the_newest_one_hundred_messages_are_retained(client, clock, monkeypatch):
    monkeypatch.setattr(main, "CHAT_BURST_MESSAGES", 1000)
    monkeypatch.setattr(main, "CHAT_WINDOW_MESSAGES", 1000)
    host = create_room(client)
    room_id = host["roomId"]

    for index in range(105):
        response = send(client, room_id, host, f"message {index}", f"retain-{index}")
        assert response.status_code == 200, response.text

    messages = client.get(f"/api/rooms/{room_id}/chat", headers=auth(host)).json()[
        "messages"
    ]
    assert len(messages) == main.CHAT_MAX_MESSAGES
    assert messages[0]["text"] == "message 5"
    assert messages[-1]["text"] == "message 104"
    assert len({message["id"] for message in messages}) == main.CHAT_MAX_MESSAGES


def test_chat_and_room_share_the_same_renewed_24_hour_expiry(
    client, clock, monkeypatch
):
    # LocalStore uses its own time-module reference for TTLs; drive it with the
    # same clock so exact aligned expiries can be asserted without sleeping.
    monkeypatch.setattr(main.devstore, "time", clock)
    host = create_room(client)
    room_id = host["roomId"]
    assert send(client, room_id, host, "Hello", "ttl-1").status_code == 200

    room_key = main._room_key(room_id)
    chat_key = main._chat_key(room_id)
    room_expiry = main.redis._data[room_key][1]
    chat_expiry = main.redis._data[chat_key][1]
    assert room_expiry == chat_expiry == clock.now + main.ROOM_TTL

    # A later room mutation renews an existing chat in the same fenced write.
    clock.advance(90)
    join(client, room_id, "Late friend")
    room_expiry = main.redis._data[room_key][1]
    chat_expiry = main.redis._data[chat_key][1]
    assert room_expiry == chat_expiry == clock.now + main.ROOM_TTL

    clock.advance(main.ROOM_TTL + 1)
    assert client.get(f"/api/rooms/{room_id}/chat", headers=auth(host)).status_code == 404
    assert client.portal.call(main.redis.get, chat_key) is None
