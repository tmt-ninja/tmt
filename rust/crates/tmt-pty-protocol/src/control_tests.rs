use super::*;

fn round_trip<F: Frame + PartialEq + std::fmt::Debug>(value: F) {
    let mut decoder = Decoder::new();
    decoder.push(&value.encode()).unwrap();
    assert_eq!(decoder.frame::<F>().unwrap(), Some(value));
    assert_eq!(decoder.frame::<F>().unwrap(), None);
}

#[test]
fn core_controls_round_trip_separately_from_attach_frames() {
    for request in [
        Control::Inspect,
        Control::Capabilities,
        Control::AwaitLaunch,
        Control::WaitLauncher,
        Control::LaunchReady { pane_pid: 123 },
        Control::Capture,
        Control::Publish {
            pane_pid: 123,
            key: "binding".into(),
            marker: "marker".into(),
        },
        Control::PublishIf {
            pane_pid: 123,
            key: "binding".into(),
            expected_key: None,
            marker: "marker".into(),
        },
        Control::Clear {
            key: "binding".into(),
        },
        Control::Paste(b"two lines\nkept together".to_vec()),
        Control::Enter,
        Control::Resume,
        Control::Relaunch {
            kind: RelaunchKind::Resume,
            program: vec!["/bin/tmt".into(), "resume".into(), String::new()],
        },
        Control::Relaunch {
            kind: RelaunchKind::Shell,
            program: vec!["/bin/sh".into()],
        },
        Control::Close,
    ] {
        let frame = ClientMessage::Control(request);
        assert!((0x20..=0x2f).contains(&frame.kind()));
        round_trip(frame);
    }
    for answer in [
        ControlReply::State {
            supervisor_pid: 12,
            pane_pid: 123,
            key_idle_ms: None,
            marker: None,
            paused: false,
            ended: None,
            shell: false,
            relaunching: false,
        },
        ControlReply::State {
            supervisor_pid: 12,
            pane_pid: 123,
            key_idle_ms: Some(0),
            marker: Some("marker".into()),
            paused: true,
            ended: Some(Exit::Signal(2)),
            shell: true,
            relaunching: true,
        },
        ControlReply::State {
            supervisor_pid: 12,
            pane_pid: 123,
            key_idle_ms: None,
            marker: None,
            paused: false,
            ended: Some(Exit::Code(-1)),
            shell: false,
            relaunching: false,
        },
        ControlReply::Launched("committed-marker".into()),
        ControlReply::Applied(true),
        ControlReply::Applied(false),
        ControlReply::Capabilities {
            resume: true,
            relaunch: true,
            close: true,
        },
        ControlReply::Capabilities {
            resume: false,
            relaunch: false,
            close: false,
        },
        ControlReply::Capabilities {
            resume: true,
            relaunch: false,
            close: true,
        },
        ControlReply::Screen(String::new()),
        ControlReply::Screen("visible".into()),
        ControlReply::Error("screen exceeds capture bound".into()),
    ] {
        round_trip(ServerMessage::Control(answer));
    }
}

#[test]
fn malformed_controls_never_become_input() {
    for (kind, data) in [
        (0x20, vec![1]),
        (0x21, vec![]),
        (0x22, vec![]),
        (0x23, vec![1]),
        (0x24, vec![0; MAX_PAYLOAD + 1]),
        (0x25, vec![1]),
    ] {
        assert!(ClientMessage::read(kind, &data).is_err(), "kind={kind:x}");
    }
    assert!(ServerMessage::read(0xa1, &[2]).is_err());
    assert!(ServerMessage::read(0xa0, &[0; 16]).is_err());
}

#[test]
fn screen_dimensions_are_bounded_before_allocating_a_screen() {
    assert!(Size::new(1000, 1000).is_ok());
    assert!(Size::new(1001, 1).is_err());
    assert!(Size::new(1, 1001).is_err());
    assert!(ClientMessage::read(0x03, &[0x03, 0xe9, 0, 1]).is_err());
    assert!(ServerMessage::read(0x86, &[0, 1, 0x03, 0xe9]).is_err());
}

#[test]
fn a_core_paste_is_one_bounded_frame_even_above_the_keystroke_chunk_size() {
    round_trip(ClientMessage::Control(Control::Paste(vec![
        b'x';
        MAX_PAYLOAD
    ])));
    assert!(Control::read(0x24, &vec![b'x'; MAX_PAYLOAD + 1]).is_err());
}

#[test]
fn legacy_publish_keeps_its_original_frame_bytes() {
    let frame = ClientMessage::Control(Control::Publish {
        pane_pid: 123,
        key: "b".into(),
        marker: "m".into(),
    });
    assert_eq!(
        frame.encode(),
        vec![0x21, 0, 0, 0, 10, 0, 0, 0, 123, 0, 1, b'b', 0, 1, b'm']
    );
}

#[test]
fn resume_is_an_empty_control_frame() {
    assert_eq!(
        ClientMessage::Control(Control::Resume).encode(),
        vec![0x2b, 0, 0, 0, 0]
    );
    assert!(ClientMessage::read(0x2b, &[0]).is_err());
}

/// A supervisor started before `paused` existed outlives an upgrade: its
/// State payload has no trailing byte and must still decode, as not paused.
#[test]
fn a_state_without_the_paused_byte_decodes_as_not_paused() {
    let mut legacy = Vec::new();
    legacy.extend_from_slice(&12u32.to_be_bytes());
    legacy.extend_from_slice(&123u32.to_be_bytes());
    legacy.extend_from_slice(&u64::MAX.to_be_bytes());
    legacy.extend_from_slice(&[0, 1, b'm']);
    assert_eq!(
        ServerMessage::read(0xa0, &legacy).unwrap(),
        ServerMessage::Control(ControlReply::State {
            supervisor_pid: 12,
            pane_pid: 123,
            key_idle_ms: None,
            marker: Some("m".into()),
            paused: false,
            ended: None,
            shell: false,
            relaunching: false,
        })
    );
    for (byte, paused) in [(0u8, false), (1, true)] {
        let mut current = legacy.clone();
        current.push(byte);
        let Ok(ServerMessage::Control(ControlReply::State { paused: read, .. })) =
            ServerMessage::read(0xa0, &current)
        else {
            panic!("a current State must decode");
        };
        assert_eq!(read, paused);
    }
    // The later group is all or nothing: the seven bytes of `ended`, `shell` and
    // `relaunching` (a group without its last byte is malformed), each flag 0 or 1.
    for trailing in [
        vec![2],
        vec![0xff],
        vec![0, 0],
        vec![1, 0],
        vec![0, 0, 0, 0, 0, 0, 0],
        vec![0, 0, 0, 0, 0, 0, 0, 2],
        vec![0, 0, 0, 0, 0, 0, 2, 0],
    ] {
        let mut bad = legacy.clone();
        bad.extend_from_slice(&trailing);
        assert!(
            ServerMessage::read(0xa0, &bad).is_err(),
            "trailing={trailing:?}"
        );
    }
}

#[test]
fn capability_flags_ignore_unknown_bits_and_need_exactly_one_byte() {
    assert_eq!(
        ServerMessage::read(0xa5, &[0xff]).unwrap(),
        ServerMessage::Control(ControlReply::Capabilities {
            resume: true,
            relaunch: true,
            close: true,
        })
    );
    assert_eq!(
        ServerMessage::read(0xa5, &[0xf8]).unwrap(),
        ServerMessage::Control(ControlReply::Capabilities {
            resume: false,
            relaunch: false,
            close: false,
        })
    );
    // A supervisor from #5926 grants resume only: Core sends it no Relaunch or Close.
    assert_eq!(
        ServerMessage::read(0xa5, &[0x01]).unwrap(),
        ServerMessage::Control(ControlReply::Capabilities {
            resume: true,
            relaunch: false,
            close: false,
        })
    );
    assert!(ServerMessage::read(0xa5, &[]).is_err());
    assert!(ServerMessage::read(0xa5, &[1, 0]).is_err());
}

/// A supervisor from before the kept terminal sends State with the paused byte
/// and nothing after it; one from before pausing sends neither. Both decode as
/// "not ended, no shell", and only the whole six-byte group is accepted.
#[test]
fn a_state_without_the_ended_group_decodes_as_running() {
    let mut base = Vec::new();
    base.extend_from_slice(&12u32.to_be_bytes());
    base.extend_from_slice(&123u32.to_be_bytes());
    base.extend_from_slice(&u64::MAX.to_be_bytes());
    base.extend_from_slice(&[0, 0]);
    for trailing in [vec![], vec![1]] {
        let mut payload = base.clone();
        payload.extend_from_slice(&trailing);
        let Ok(ServerMessage::Control(ControlReply::State { ended, shell, .. })) =
            ServerMessage::read(0xa0, &payload)
        else {
            panic!("an older State must decode: {trailing:?}");
        };
        assert_eq!((ended, shell), (None, false));
    }
    let current = |tail: &[u8]| {
        let mut payload = base.clone();
        payload.push(0);
        payload.extend_from_slice(tail);
        ServerMessage::read(0xa0, &payload)
    };
    let Ok(ServerMessage::Control(ControlReply::State {
        ended,
        shell,
        relaunching,
        ..
    })) = current(&[1, 0, 0, 0, 3, 1, 1])
    else {
        panic!("a current State must decode");
    };
    assert_eq!(
        (ended, shell, relaunching),
        (Some(Exit::Code(3)), true, true)
    );
    for bad in [
        &[1, 0, 0, 0][..],
        &[1, 0, 0, 0, 3, 1],
        &[3, 0, 0, 0, 0, 0, 0],
        &[0, 0, 0, 0, 1, 0, 0],
        &[1, 0, 0, 0, 0, 2, 0],
        &[1, 0, 0, 0, 0, 0, 2],
        &[1, 0, 0, 0, 0, 0, 0, 0],
    ] {
        assert!(current(bad).is_err(), "{bad:?}");
    }
}

#[test]
fn relaunch_and_close_frames_are_bounded_and_strict() {
    assert_eq!(
        ClientMessage::Control(Control::Close).encode(),
        vec![0x2d, 0, 0, 0, 0]
    );
    assert!(ClientMessage::read(0x2d, &[0]).is_err());
    let encoded = ClientMessage::Control(Control::Relaunch {
        kind: RelaunchKind::New,
        program: vec!["a".into()],
    })
    .encode();
    assert_eq!(encoded, vec![0x2c, 0, 0, 0, 6, 1, 0, 1, 0, 1, b'a']);
    for malformed in [
        // No program words, an unknown kind, an empty program name.
        vec![0, 0, 0],
        vec![3, 0, 1, 0, 1, b'a'],
        vec![0, 0, 1, 0, 0],
        // A word count larger than the words sent, and bytes after the words.
        vec![0, 0, 2, 0, 1, b'a'],
        vec![0, 0, 1, 0, 1, b'a', 0],
        // More than 256 words.
        [vec![0, 1, 1], [0u8, 1, b'a'].repeat(257)].concat(),
    ] {
        assert!(
            ClientMessage::read(0x2c, &malformed).is_err(),
            "{malformed:?}"
        );
    }
}
