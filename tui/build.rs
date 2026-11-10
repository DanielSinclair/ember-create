fn main() {
    let entry = std::path::Path::new("terminal.contract");
    contract::rerun_if_changed(entry);
    let plan = contract::compile_path_terminal(entry).unwrap_or_else(|e| panic!("{e:?}"));
    let out = std::path::PathBuf::from(std::env::var_os("OUT_DIR").unwrap());
    std::fs::write(out.join("terminal.plan"), plan.encode()).unwrap();
    std::fs::write(out.join("shapes.rs"), contract::rust(&plan).unwrap()).unwrap();
}
