use super::*;
use crate::pty::protocol::{Decoder, Frame, VERSION};
use std::{thread, time::Duration};

fn receive(peer: &mut UnixStream, decoder: &mut Decoder) -> ClientMessage {
    loop {
        if let Some(message) = decoder.frame().unwrap() {
            return message;
        }
        let mut bytes = [0; 4096];
        let count = peer.read(&mut bytes).expect("bounded peer read");
        assert!(count > 0, "client left before its frame");
        decoder.push(&bytes[..count]).unwrap();
    }
}

fn peer(
    run: impl FnOnce(UnixStream, Decoder) + Send + 'static,
) -> (Connection, thread::JoinHandle<()>) {
    let (client, mut server) = UnixStream::pair().unwrap();
    server
        .set_read_timeout(Some(Duration::from_secs(5)))
        .unwrap();
    server
        .set_write_timeout(Some(Duration::from_secs(5)))
        .unwrap();
    let job = thread::spawn(move || {
        let mut decoder = Decoder::new();
        assert_eq!(
            receive(&mut server, &mut decoder),
            ClientMessage::Hello { version: VERSION }
        );
        server
            .write_all(
                &ServerMessage::Welcome {
                    version: VERSION,
                    size: Size::new(80, 24).unwrap(),
                }
                .encode(),
            )
            .unwrap();
        run(server, decoder);
    });
    (Connection::handshake(client).unwrap(), job)
}

fn empty_snapshot(peer: &mut UnixStream, decoder: &mut Decoder) {
    empty_snapshot_at(peer, decoder, Size::new(80, 24).unwrap());
}

/// An empty screen taken at `size`, the size the client asked for.
fn empty_snapshot_at(peer: &mut UnixStream, decoder: &mut Decoder, size: Size) {
    assert_eq!(receive(peer, decoder), ClientMessage::Snapshot);
    peer.write_all(&ServerMessage::SnapshotStart.encode())
        .unwrap();
    peer.write_all(&ServerMessage::SnapshotEnd(size).encode())
        .unwrap();
}

#[test]
fn detach_consumes_only_its_control_byte_and_discards_trailing_input() {
    let (mut connection, server) = peer(|mut peer, mut decoder| {
        assert_eq!(
            receive(&mut peer, &mut decoder),
            ClientMessage::Resize(Size::new(80, 24).unwrap())
        );
        // Input may detach before the screen reply; this peer must not race a write.
        assert_eq!(receive(&mut peer, &mut decoder), ClientMessage::Snapshot);
        assert_eq!(
            receive(&mut peer, &mut decoder),
            ClientMessage::Input(b"\x03before".to_vec())
        );
        assert_eq!(receive(&mut peer, &mut decoder), ClientMessage::Detach);
        let mut bytes = [0; 64];
        assert_eq!(
            peer.read(&mut bytes).unwrap(),
            0,
            "nothing after Detach reaches the program"
        );
    });
    let (input, mut typed) = UnixStream::pair().unwrap();
    typed
        .write_all(b"\x03before\x1cnever-forward-this")
        .unwrap();
    let mut output = Vec::new();
    let mut signals = AttachSignals::install().unwrap();
    assert_eq!(
        attach(
            &mut connection,
            &input,
            &mut output,
            &mut signals,
            false,
            || Size::new(80, 24).map_err(io::Error::other)
        )
        .unwrap(),
        AttachEnd::Detached
    );
    drop(connection);
    server.join().unwrap();
}

#[test]
fn output_passes_through_exactly_and_resize_notifications_only_update_state() {
    let bytes = b"\x1b[31mraw\0\xff\r\n\x1b[0m";
    let (mut connection, server) = peer(move |mut peer, mut decoder| {
        assert!(matches!(
            receive(&mut peer, &mut decoder),
            ClientMessage::Resize(_)
        ));
        empty_snapshot(&mut peer, &mut decoder);
        peer.write_all(&ServerMessage::Output(bytes.to_vec()).encode())
            .unwrap();
        peer.write_all(&ServerMessage::Resized(Size::new(97, 41).unwrap()).encode())
            .unwrap();
        // Fragment the terminal result to exercise the nonblocking decoder.
        for byte in ServerMessage::Exited(Exit::Code(7)).encode() {
            peer.write_all(&[byte]).unwrap();
        }
    });
    let (input, _typed) = UnixStream::pair().unwrap();
    let mut output = Vec::new();
    let mut signals = AttachSignals::install().unwrap();
    assert_eq!(
        attach(
            &mut connection,
            &input,
            &mut output,
            &mut signals,
            false,
            || Size::new(80, 24).map_err(io::Error::other)
        )
        .unwrap(),
        AttachEnd::Exited(Exit::Code(7))
    );
    assert_eq!(output, [CLEAR_SCREEN, bytes].concat());
    assert_eq!(connection.size(), Size::new(97, 41).unwrap());
    server.join().unwrap();
}

#[test]
fn sole_use_follows_this_clients_resize_and_eviction_is_reported() {
    let (mut connection, server) = peer(|mut peer, mut decoder| {
        assert_eq!(
            receive(&mut peer, &mut decoder),
            ClientMessage::Resize(Size::new(120, 30).unwrap())
        );
        assert_eq!(receive(&mut peer, &mut decoder), ClientMessage::TakeSole);
        empty_snapshot_at(&mut peer, &mut decoder, Size::new(120, 30).unwrap());
        peer.write_all(&ServerMessage::Evicted(Eviction::TakenOver).encode())
            .unwrap();
    });
    let (input, _typed) = UnixStream::pair().unwrap();
    let mut signals = AttachSignals::install().unwrap();
    assert_eq!(
        attach(
            &mut connection,
            &input,
            &mut Vec::new(),
            &mut signals,
            true,
            || Size::new(120, 30).map_err(io::Error::other)
        )
        .unwrap(),
        AttachEnd::Evicted(Eviction::TakenOver)
    );
    server.join().unwrap();
}

#[test]
fn a_lost_supervisor_is_not_a_program_exit() {
    let (mut connection, server) = peer(|mut peer, mut decoder| {
        assert!(matches!(
            receive(&mut peer, &mut decoder),
            ClientMessage::Resize(_)
        ));
        empty_snapshot(&mut peer, &mut decoder);
    });
    let (input, _typed) = UnixStream::pair().unwrap();
    let mut signals = AttachSignals::install().unwrap();
    let error = attach(
        &mut connection,
        &input,
        &mut Vec::new(),
        &mut signals,
        false,
        || Size::new(80, 24).map_err(io::Error::other),
    )
    .unwrap_err();
    assert_eq!(error.kind(), io::ErrorKind::UnexpectedEof);
    server.join().unwrap();
}

#[test]
fn input_eof_detaches_instead_of_stopping_the_member() {
    let (mut connection, server) = peer(|mut peer, mut decoder| {
        assert!(matches!(
            receive(&mut peer, &mut decoder),
            ClientMessage::Resize(_)
        ));
        // Input may detach before the screen reply; this peer must not race a write.
        assert_eq!(receive(&mut peer, &mut decoder), ClientMessage::Snapshot);
        assert_eq!(receive(&mut peer, &mut decoder), ClientMessage::Detach);
    });
    let (input, typed) = UnixStream::pair().unwrap();
    drop(typed);
    let mut signals = AttachSignals::install().unwrap();
    assert_eq!(
        attach(
            &mut connection,
            &input,
            &mut Vec::new(),
            &mut signals,
            false,
            || Size::new(80, 24).map_err(io::Error::other)
        )
        .unwrap(),
        AttachEnd::Detached
    );
    server.join().unwrap();
}

#[test]
fn initial_screen_supersedes_old_output_and_streams_multiple_chunks_before_live() {
    let first = vec![b'A'; 16 * 1024];
    let second = b"\x1b[32mcurrent-tail\x1b[0m".to_vec();
    let expected = [
        CLEAR_SCREEN,
        first.as_slice(),
        second.as_slice(),
        b"live-once",
    ]
    .concat();
    let (mut connection, server) = peer(move |mut peer, mut decoder| {
        assert!(matches!(
            receive(&mut peer, &mut decoder),
            ClientMessage::Resize(_)
        ));
        assert_eq!(receive(&mut peer, &mut decoder), ClientMessage::Snapshot);
        for message in [
            ServerMessage::Output(b"superseded-old-output".to_vec()),
            ServerMessage::SnapshotStart,
            ServerMessage::SnapshotData(first),
            ServerMessage::SnapshotData(second),
            ServerMessage::SnapshotEnd(Size::new(80, 24).unwrap()),
            ServerMessage::Output(b"live-once".to_vec()),
            ServerMessage::Exited(Exit::Code(0)),
        ] {
            peer.write_all(&message.encode()).unwrap();
        }
    });
    let (input, _typed) = UnixStream::pair().unwrap();
    let mut output = Vec::new();
    let mut signals = AttachSignals::install().unwrap();
    assert_eq!(
        attach(
            &mut connection,
            &input,
            &mut output,
            &mut signals,
            false,
            || Size::new(80, 24).map_err(io::Error::other)
        )
        .unwrap(),
        AttachEnd::Exited(Exit::Code(0))
    );
    assert_eq!(output, expected);
    server.join().unwrap();
}

#[test]
fn an_initial_screen_over_the_safety_bound_clears_and_continues_live() {
    let (mut connection, server) = peer(|mut peer, mut decoder| {
        assert!(matches!(
            receive(&mut peer, &mut decoder),
            ClientMessage::Resize(_)
        ));
        assert_eq!(receive(&mut peer, &mut decoder), ClientMessage::Snapshot);
        peer.write_all(&ServerMessage::SnapshotStart.encode())
            .unwrap();
        let frame = ServerMessage::SnapshotData(vec![b'A'; 16 * 1024]).encode();
        for _ in 0..64 {
            peer.write_all(&frame).unwrap();
        }
        for message in [
            ServerMessage::SnapshotData(b"discard-overflow".to_vec()),
            ServerMessage::SnapshotData(b"discard-rest".to_vec()),
            ServerMessage::SnapshotEnd(Size::new(80, 24).unwrap()),
            ServerMessage::Output(b"live-after-bound".to_vec()),
            ServerMessage::Exited(Exit::Code(0)),
        ] {
            peer.write_all(&message.encode()).unwrap();
        }
    });
    let (input, _typed) = UnixStream::pair().unwrap();
    let mut output = Vec::new();
    let mut signals = AttachSignals::install().unwrap();
    assert_eq!(
        attach(
            &mut connection,
            &input,
            &mut output,
            &mut signals,
            false,
            || Size::new(80, 24).map_err(io::Error::other)
        )
        .unwrap(),
        AttachEnd::Exited(Exit::Code(0))
    );
    assert_eq!(
        output,
        [
            CLEAR_SCREEN,
            &vec![b'A'; 1024 * 1024],
            CLEAR_SCREEN,
            b"live-after-bound"
        ]
        .concat()
    );
    server.join().unwrap();
}

#[test]
fn out_of_order_snapshot_frames_are_not_painted_as_live_bytes() {
    for message in [
        ServerMessage::SnapshotData(b"unframed".to_vec()),
        ServerMessage::SnapshotEnd(Size::new(80, 24).unwrap()),
    ] {
        let (mut connection, server) = peer(move |mut peer, mut decoder| {
            assert!(matches!(
                receive(&mut peer, &mut decoder),
                ClientMessage::Resize(_)
            ));
            assert_eq!(receive(&mut peer, &mut decoder), ClientMessage::Snapshot);
            peer.write_all(&message.encode()).unwrap();
        });
        let (input, _typed) = UnixStream::pair().unwrap();
        let mut output = Vec::new();
        let mut signals = AttachSignals::install().unwrap();
        let result = attach(
            &mut connection,
            &input,
            &mut output,
            &mut signals,
            false,
            || Size::new(80, 24).map_err(io::Error::other),
        );
        assert_eq!(result.unwrap_err().kind(), io::ErrorKind::InvalidData);
        assert!(output.is_empty());
        server.join().unwrap();
    }
}

fn size(cols: u16, rows: u16) -> Size {
    Size::new(cols, rows).unwrap()
}

fn send(peer: &mut UnixStream, messages: &[ServerMessage]) {
    for message in messages {
        peer.write_all(&message.encode()).unwrap();
    }
}

/// Everything the client sends after `Exited`, which must be nothing.
fn nothing_more(peer: &mut UnixStream, decoder: &mut Decoder) {
    let mut bytes = [0; 64];
    let count = peer.read(&mut bytes).unwrap();
    decoder.push(&bytes[..count]).unwrap();
    assert_eq!(decoder.frame::<ClientMessage>().unwrap(), None);
}

fn run(connection: &mut Connection, output: &mut Vec<u8>) -> AttachEnd {
    let (input, _typed) = UnixStream::pair().unwrap();
    let mut signals = AttachSignals::install().unwrap();
    attach(connection, &input, output, &mut signals, false, || {
        Size::new(80, 24).map_err(io::Error::other)
    })
    .unwrap()
}

#[test]
fn a_snapshot_at_another_size_is_asked_for_once_more_then_repainted_when_the_size_returns() {
    let (mut connection, server) = peer(|mut peer, mut decoder| {
        assert_eq!(
            receive(&mut peer, &mut decoder),
            ClientMessage::Resize(size(80, 24))
        );
        assert_eq!(receive(&mut peer, &mut decoder), ClientMessage::Snapshot);
        // Another client resizes before the snapshot is taken.
        send(
            &mut peer,
            &[
                ServerMessage::Resized(size(100, 30)),
                ServerMessage::SnapshotStart,
                ServerMessage::SnapshotData(b"wide".to_vec()),
                ServerMessage::SnapshotEnd(size(100, 30)),
            ],
        );
        // One retry: this size again, then the screen again.
        assert_eq!(
            receive(&mut peer, &mut decoder),
            ClientMessage::Resize(size(80, 24))
        );
        assert_eq!(receive(&mut peer, &mut decoder), ClientMessage::Snapshot);
        // The retry's own Resized is not a return; the other client wins again.
        send(
            &mut peer,
            &[
                ServerMessage::Resized(size(80, 24)),
                ServerMessage::Resized(size(120, 40)),
                ServerMessage::SnapshotStart,
                ServerMessage::SnapshotData(b"wider".to_vec()),
                ServerMessage::SnapshotEnd(size(120, 40)),
                ServerMessage::Output(b"live".to_vec()),
                // The user types, and the supervisor gives this terminal its size back.
                ServerMessage::Resized(size(80, 24)),
            ],
        );
        // No second retry: the next request is the repaint at this terminal's size.
        assert_eq!(receive(&mut peer, &mut decoder), ClientMessage::Snapshot);
        send(
            &mut peer,
            &[
                ServerMessage::SnapshotStart,
                ServerMessage::SnapshotData(b"fits".to_vec()),
                ServerMessage::SnapshotEnd(size(80, 24)),
                ServerMessage::Exited(Exit::Code(0)),
            ],
        );
        nothing_more(&mut peer, &mut decoder);
    });
    let mut output = Vec::new();
    assert_eq!(
        run(&mut connection, &mut output),
        AttachEnd::Exited(Exit::Code(0))
    );
    assert_eq!(
        output,
        [
            CLEAR_SCREEN,
            b"wide",
            CLEAR_SCREEN,
            b"wider",
            b"live",
            CLEAR_SCREEN,
            b"fits"
        ]
        .concat()
    );
    drop(connection);
    server.join().unwrap();
}

#[test]
fn a_screen_switch_never_reaches_the_outer_terminal_and_repaints_the_member_screen() {
    let (mut connection, server) = peer(|mut peer, mut decoder| {
        assert!(matches!(
            receive(&mut peer, &mut decoder),
            ClientMessage::Resize(_)
        ));
        assert_eq!(receive(&mut peer, &mut decoder), ClientMessage::Snapshot);
        send(
            &mut peer,
            &[
                ServerMessage::SnapshotStart,
                // A member already on its alternate screen.
                ServerMessage::SnapshotData(b"\x1b[?1049hALT-MARK".to_vec()),
                ServerMessage::SnapshotEnd(size(80, 24)),
                // It leaves without a redraw, the sequence split across two reads.
                ServerMessage::Output(b"bye\x1b[?10".to_vec()),
                ServerMessage::Output(b"49l\x1b[?25h".to_vec()),
            ],
        );
        assert_eq!(receive(&mut peer, &mut decoder), ClientMessage::Snapshot);
        send(
            &mut peer,
            &[
                ServerMessage::Output(b"after".to_vec()),
                ServerMessage::SnapshotStart,
                ServerMessage::SnapshotData(b"NORMAL-MARK".to_vec()),
                ServerMessage::SnapshotEnd(size(80, 24)),
                ServerMessage::Exited(Exit::Code(0)),
            ],
        );
        nothing_more(&mut peer, &mut decoder);
    });
    let mut output = Vec::new();
    assert_eq!(
        run(&mut connection, &mut output),
        AttachEnd::Exited(Exit::Code(0))
    );
    assert_eq!(
        output,
        [
            CLEAR_SCREEN,
            b"ALT-MARK",
            b"bye",
            b"\x1b[?25h",
            b"after",
            CLEAR_SCREEN,
            b"NORMAL-MARK"
        ]
        .concat()
    );
    drop(connection);
    server.join().unwrap();
}
