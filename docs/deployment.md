# Deployment & Release Process

## Overview

Per Ankh uses GitHub Actions to automatically build and release the application for macOS and Windows platforms.

## Release Process

### 1. Prepare the Release

Ensure all changes are committed and the app is working correctly:

```bash
# Run tests
cargo test

# Run type checking
npm run check

# Test the build locally
npm run tauri:build
```

### 2. Create a Release Tag

The GitHub Actions workflow triggers on version tags:

```bash
# Update version in package.json and tauri.conf.json if needed
# (Both should match, e.g., "0.1.0")

# Create and push a tag
git tag v0.1.0
git push origin v0.1.0
```

### 3. Automatic Build Process

Once the tag is pushed, GitHub Actions will:

1. **Build for macOS** (both Intel and Apple Silicon):
   - `Per-Ankh_x.x.x_x64.dmg` (Intel Macs)
   - `Per-Ankh_x.x.x_aarch64.dmg` (Apple Silicon Macs)

2. **Build for Windows**:
   - `Per-Ankh_x.x.x_x64-setup.exe` (installer)
   - `Per-Ankh_x.x.x_x64_en-US.msi` (MSI installer)

3. **Create GitHub Release**:
   - Creates a draft release with the tag name
   - Uploads all build artifacts as release assets
   - Includes checksums for verification

### 4. Publish the Release

1. Go to the [Releases page](https://github.com/becked/per-ankh/releases)
2. Find the draft release created by the workflow
3. Edit the release notes to describe what's new
4. Click "Publish release"

## Build Artifacts

Each release includes the following files:

### macOS
- `Per-Ankh_x.x.x_aarch64.dmg` - Apple Silicon installer
- `Per-Ankh_x.x.x_x64.dmg` - Intel Mac installer
- `Per-Ankh.app.tar.gz` - Portable app bundle (both architectures)

### Windows
- `Per-Ankh_x.x.x_x64-setup.exe` - NSIS installer (recommended)
- `Per-Ankh_x.x.x_x64_en-US.msi` - MSI installer

## Manual Build (Local Development)

If you need to build locally for testing:

```bash
# Build for your current platform
npm run tauri:build

# Output location:
# macOS: src-tauri/target/release/bundle/dmg/
# Windows: src-tauri/target/release/bundle/nsis/ or bundle/msi/
```

## GitHub Actions Costs

- **Public repositories**: FREE unlimited builds
- **Private repositories**:
  - 2,000 free minutes/month
  - macOS builds count as 10x (expensive)
  - Windows builds count as 2x
  - Typical release: ~110-230 charged minutes

## Troubleshooting

### Build Failures

Check the GitHub Actions logs:
1. Go to the "Actions" tab in your repository
2. Click on the failed workflow run
3. Expand the failed job to see detailed logs

Common issues:
- **Missing dependencies**: Ensure `package.json` and `Cargo.toml` are up to date
- **Type errors**: Run `npm run check` locally first
- **Rust compilation errors**: Run `cargo check` locally first

### Release Not Created

Ensure:
- Tag follows the `v*.*.*` pattern (e.g., `v0.1.0`, not `0.1.0`)
- Repository has "Read and write permissions" for workflows (Settings > Actions > General > Workflow permissions)

## Version Numbering

Follow [Semantic Versioning](https://semver.org/):

- `v0.1.0` - Initial development
- `v1.0.0` - First stable release
- `v1.1.0` - New features (minor)
- `v1.1.1` - Bug fixes (patch)
- `v2.0.0` - Breaking changes (major)

## Workflow Configuration

The release workflow is defined in `.github/workflows/release.yml` and:

- Triggers on tags matching `v*`
- Builds for macOS (Intel + Apple Silicon) and Windows
- Uses Rust and Node.js caching for faster builds
- Creates draft releases (requires manual publishing)
- Automatically generates checksums for all artifacts

## Future Enhancements

Potential improvements to the release process:

1. **Auto-updater**: Integrate Tauri's built-in updater with GitHub Releases
2. **Linux builds**: Add Ubuntu builds to the workflow
3. **Changelog automation**: Generate release notes from commit messages
4. **Beta releases**: Create pre-release builds from `beta` branch
5. **Signed builds**: Add code signing for macOS and Windows (requires certificates)
