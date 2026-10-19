/* Offline debug APK builder for this dependency-free native application.
 * Standard Gradle builds remain supported; this path needs only Node, JDK 17 and Android SDK.
 * Usage: node android/build-native.mjs --sdk <SDK directory> --jdk <JDK directory>
 * Generated files stay under app/build/. The persistent TEST signing key stays under .signing/.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, copyFileSync } from 'node:fs';
import { dirname, join, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
function option(name, fallback) {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : fallback;
}
const sdk = option('--sdk', process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT);
const jdk = option('--jdk', process.env.JAVA_HOME);
if (!sdk || !jdk) {
  console.error('Provide --sdk and --jdk, or ANDROID_HOME and JAVA_HOME. No system settings are changed.');
  process.exit(1);
}
const gradle = readFileSync(join(root, 'app/build.gradle'), 'utf8');
const namespace = gradle.match(/namespace\s+'([^']+)'/)[1];
const applicationId = gradle.match(/applicationId\s+'([^']+)'/)[1];
const compileSdk = gradle.match(/compileSdk\s+(\d+)/)[1];
const minSdk = gradle.match(/minSdk\s+(\d+)/)[1];
const targetSdk = gradle.match(/targetSdk\s+(\d+)/)[1];
const versionCode = gradle.match(/versionCode\s+(\d+)/)[1];
const versionName = gradle.match(/versionName\s+'([^']+)'/)[1];
const webVersion = gradle.match(/WEB_BACKUP_VERSION[^\n]*'"([^']+)"'/)?.[1] || '1.5.6';
const executable = name => join(jdk, 'bin', name + (process.platform === 'win32' ? '.exe' : ''));
const androidJar = join(sdk, 'platforms', `android-${compileSdk}`, 'android.jar');
const toolVersions = readdirSync(join(sdk, 'build-tools')).filter(name => /^\d+\.\d+\.\d+$/.test(name))
  .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
const tools = toolVersions.map(name => join(sdk, 'build-tools', name))
  .find(dir => existsSync(join(dir, 'lib/d8.jar')) && existsSync(join(dir, 'lib/apksigner.jar')));
if (!tools) throw new Error('No complete stable Android Build Tools found');
const tool = name => join(tools, name + (process.platform === 'win32' ? '.exe' : ''));
for (const input of [androidJar, executable('java'), executable('javac'), executable('jar'), executable('keytool'), tool('aapt2'), tool('zipalign')]) {
  if (!existsSync(input)) throw new Error('Missing build input: ' + input);
}
const generatedRoot = resolve(root, 'app/build');
const work = resolve(generatedRoot, 'native-debug');
// The only recursive cleanup is our named generated subdirectory, never the project or SDK.
if (relative(generatedRoot, work) !== 'native-debug' || !work.startsWith(generatedRoot + sep)) throw new Error('Unsafe build output path');
rmSync(work, { recursive: true, force: true });
for (const name of ['gen', 'classes', 'dex']) mkdirSync(join(work, name), { recursive: true });
// The HTML/CSS is copied byte-for-byte from the same source used by the PWA.
mkdirSync(join(work, 'assets'), { recursive: true });
for (const name of ['index.html', 'manifest.json', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png']) {
  copyFileSync(join(root, '../web', name), join(work, 'assets', name));
}
copyFileSync(join(root, 'app/src/main/web/native-adapter.js'), join(work, 'assets/native-adapter.js'));
function run(command, parameters) {
  const result = spawnSync(command, parameters, { cwd: root, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status}`);
}
function java(parameters) { run(executable('java'), parameters); }
console.log(`Building Android ${versionName} / API ${compileSdk}, using Build Tools ${tools.split(/[\\/]/).pop()}`);
const manifest = readFileSync(join(root, 'app/src/main/AndroidManifest.xml'), 'utf8')
  .replace('<manifest ', `<manifest package="${applicationId}" `)
  .replace('<application', '<application android:debuggable="true"');
writeFileSync(join(work, 'AndroidManifest.xml'), manifest);
const compiled = join(work, 'resources.zip');
run(tool('aapt2'), ['compile', '--dir', join(root, 'app/src/main/res'), '-o', compiled]);
const unsigned = join(work, 'unsigned.apk');
run(tool('aapt2'), ['link', '-o', unsigned, '-I', androidJar, '--manifest', join(work, 'AndroidManifest.xml'),
  '--java', join(work, 'gen'), '--custom-package', namespace, '--min-sdk-version', minSdk,
  '--target-sdk-version', targetSdk, '--version-code', versionCode, '--version-name', versionName, compiled]);
const generatedPackage = join(work, 'gen', ...namespace.split('.'));
mkdirSync(generatedPackage, { recursive: true });
writeFileSync(join(generatedPackage, 'BuildConfig.java'), `package ${namespace};
public final class BuildConfig {
 public static final boolean DEBUG = true;
 public static final String APPLICATION_ID = ${JSON.stringify(applicationId)};
 public static final String BUILD_TYPE = "debug";
 public static final int VERSION_CODE = ${versionCode};
 public static final String VERSION_NAME = ${JSON.stringify(versionName)};
 public static final String WEB_BACKUP_VERSION = ${JSON.stringify(webVersion)};
}
`);
function javaFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? javaFiles(join(dir, entry.name)) : entry.name.endsWith('.java') ? [join(dir, entry.name)] : []);
}
const sources = [...javaFiles(join(root, 'app/src/main/java')), ...javaFiles(join(work, 'gen'))];
// A javac argument file avoids Windows command-length limits and preserves spaces in paths.
const quote = value => '"' + value.replaceAll('\\', '/').replaceAll('"', '\\"') + '"';
const compilerArgs = ['-encoding', 'UTF-8', '-source', '17', '-target', '17', '-classpath', androidJar,
  '-d', join(work, 'classes'), ...sources];
const argumentFile = join(work, 'javac.args');
writeFileSync(argumentFile, compilerArgs.map(quote).join('\n'));
run(executable('javac'), ['@' + argumentFile]);
const classJar = join(work, 'classes.jar');
run(executable('jar'), ['--create', '--file', classJar, '-C', join(work, 'classes'), '.']);
java(['-Xmx1024m', '-cp', join(tools, 'lib/d8.jar'), 'com.android.tools.r8.D8', '--debug', '--min-api', minSdk,
  '--lib', androidJar, '--output', join(work, 'dex'), classJar]);
run(executable('jar'), ['--update', '--file', unsigned, '-C', join(work, 'dex'), '.']);
run(executable('jar'), ['--update', '--file', unsigned, '-C', work, 'assets']);
const aligned = join(work, 'aligned.apk');
run(tool('zipalign'), ['-f', '-p', '4', unsigned, aligned]);
const signingDir = join(root, '.signing');
mkdirSync(signingDir, { recursive: true });
const key = join(signingDir, 'debug.keystore');
if (!existsSync(key)) {
  run(executable('keytool'), ['-genkeypair', '-keystore', key, '-alias', 'androiddebugkey', '-storepass', 'android',
    '-keypass', 'android', '-dname', 'CN=MoneyBook Android Debug,O=MoneyBook,C=CN', '-keyalg', 'RSA', '-keysize', '2048', '-validity', '10000']);
}
const outputDir = join(generatedRoot, 'outputs/apk/debug');
mkdirSync(outputDir, { recursive: true });
const output = join(outputDir, 'app-debug.apk');
java(['-jar', join(tools, 'lib/apksigner.jar'), 'sign', '--ks', key, '--ks-key-alias', 'androiddebugkey',
  '--ks-pass', 'pass:android', '--key-pass', 'pass:android', '--min-sdk-version', minSdk, '--out', output, aligned]);
java(['-jar', join(tools, 'lib/apksigner.jar'), 'verify', '--verbose', '--print-certs', output]);
run(tool('zipalign'), ['-c', '-p', '4', output]);
run(join(tools, 'aapt' + (process.platform === 'win32' ? '.exe' : '')), ['dump', 'badging', output]);
const digest = createHash('sha256').update(readFileSync(output)).digest('hex');
writeFileSync(join(outputDir, 'app-debug.apk.sha256'), digest + '  app-debug.apk\n');
const versionedName = `moneybook-${versionName.replace(/[^a-zA-Z0-9._-]/g, '-')}-debug.apk`;
copyFileSync(output, join(outputDir, versionedName));
writeFileSync(join(outputDir, versionedName + '.sha256'), digest + '  ' + versionedName + '\n');
console.log(`\nVerified test APK: ${output}\nSHA256: ${digest}`);
console.log('TEST signature only. Keep .signing/debug.keystore for subsequent local test updates; never commit it.');
