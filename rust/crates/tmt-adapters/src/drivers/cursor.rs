//! Cursor CLI: basic detection and caller evidence, without a launch or hook runtime.

mod caller;

pub(super) const NAME: &str = tmt_core::driver::descriptor::CURSOR.name;
pub(super) const EXECUTABLE: &str = tmt_core::driver::descriptor::CURSOR.executables[0];

pub static DRIVER: super::DriverDefinition = super::DriverDefinition {
    descriptor: &tmt_core::driver::descriptor::CURSOR,
    env: &[],
    locate,
    runtime: None,
    identify_caller: Some(caller::identify_caller),
};

fn locate(environment: &crate::skill_installation::ProviderEnvironment) -> super::Locations {
    super::Locations {
        config_dirs: Vec::new(),
        skills: environment.universal_skills(),
        legacy_skills: Vec::new(),
        hook_settings: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        drivers::{Detection, Registry},
        skill_installation::ProviderEnvironment,
        test_support::TestDirectory,
    };
    use std::{fs, os::unix::fs::PermissionsExt};
    #[test]
    fn alias_detection_is_filesystem_only_and_basic_has_no_provider_locations() {
        // Documentation-derived synthetic fixture, never a real Cursor executable/config.
        let directory = TestDirectory::new();
        let home = directory.path.join("home");
        let bin = directory.path.join("bin");
        fs::create_dir_all(&bin).unwrap();
        let environment = ProviderEnvironment::from_parts(&home, &home, vec![bin.clone()], []);
        let locations = environment.locations(&DRIVER);
        assert!(locations.config_dirs.is_empty());
        assert!(locations.legacy_skills.is_empty());
        assert_eq!(locations.skills, environment.universal_skills());
        assert_eq!(locations.hook_settings, None);
        assert!(DRIVER.runtime.is_none());
        assert!(DRIVER.identify_caller.is_some());
        let detect = || {
            Registry::builtin()
                .detect(&environment)
                .into_iter()
                .find(|(driver, _)| driver.name() == NAME)
                .unwrap()
                .1
        };
        assert_eq!(detect(), Detection::Absent);
        fs::write(bin.join("agent"), "#!/bin/sh\nexit 0\n").unwrap();
        fs::set_permissions(bin.join("agent"), fs::Permissions::from_mode(0o755)).unwrap();
        assert_eq!(
            detect(),
            Detection::Absent,
            "generic agent is not Cursor provenance"
        );
        let alias = bin.join(EXECUTABLE);
        fs::write(&alias, "#!/bin/sh\ntouch \"$0.ran\"\n").unwrap();
        fs::set_permissions(&alias, fs::Permissions::from_mode(0o644)).unwrap();
        assert!(matches!(detect(), Detection::Broken { .. }));
        fs::set_permissions(&alias, fs::Permissions::from_mode(0o755)).unwrap();
        assert_eq!(detect(), Detection::Present { version: None });
        assert!(!bin.join("cursor-agent.ran").exists());
        assert!(!home.exists());
    }
}
