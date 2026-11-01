//! A built app directory as the serve would load it (`--app-dir`, #5866): the same inventory,
//! entry and size checks, without starting a serve. Opt-in, since it needs a build:
//! `TMT_COLAB_CHECK_APP_DIR=<absolute dist> cargo test -p tmt-colab --test app_dir -- --ignored`.

#[test]
#[ignore = "needs TMT_COLAB_CHECK_APP_DIR, a built app directory"]
fn the_built_app_directory_loads_as_the_serve_loads_it() {
    let directory = std::env::var_os("TMT_COLAB_CHECK_APP_DIR").expect("set TMT_COLAB_CHECK_APP_DIR");
    let directory = std::path::PathBuf::from(directory);
    if let Err(error) = tmt_colab::assets::App::load(&directory) {
        panic!("{}: {error}", directory.display());
    }
}
