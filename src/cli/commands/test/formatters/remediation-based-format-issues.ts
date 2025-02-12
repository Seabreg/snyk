import chalk from 'chalk';
import * as wrap from 'wrap-ansi';
import * as config from '../../../../lib/config';
import { TestOptions } from '../../../../lib/types';
import {
  RemediationChanges, PatchRemediation,
  DependencyUpdates, IssueData, SEVERITY, GroupedVuln,
  DependencyPins,
  UpgradeRemediation,
  PinRemediation,
} from '../../../../lib/snyk-test/legacy';
import { SEVERITIES } from '../../../../lib/snyk-test/common';

interface BasicVulnInfo {
  type: string;
  title: string;
  severity: SEVERITY;
  isNew: boolean;
  name: string;
  version: string;
  fixedIn: string[];
  legalInstructions?: string;
  paths: string[][];
}

interface TopLevelPackageUpgrade {
  name: string;
  version: string;
}

interface UpgradesByAffectedPackage {
  [pkgNameAndVersion: string]: TopLevelPackageUpgrade[];
}

export function formatIssuesWithRemediation(
  vulns: GroupedVuln[],
  remediationInfo: RemediationChanges,
  options: TestOptions,
): string[] {

  const basicVulnInfo: {
    [name: string]: BasicVulnInfo,
  } = {};

  const basicLicenseInfo: {
    [name: string]: BasicVulnInfo,
  } = {};

  for (const vuln of vulns) {
    const vulnData = {
      title: vuln.title,
      severity: vuln.severity,
      isNew: vuln.isNew,
      name: vuln.name,
      type: vuln.metadata.type,
      version: vuln.version,
      fixedIn: vuln.fixedIn,
      legalInstructions: vuln.legalInstructions,
      paths: vuln.list.map((v) => v.from),
    };

    if (vulnData.type === 'license') {
      basicLicenseInfo[vuln.metadata.id] = vulnData;
    } else {
      basicVulnInfo[vuln.metadata.id] = vulnData;
    }
  }

  const results = [''];

  let upgradeTextArray: string[];
  if (remediationInfo.pin && Object.keys(remediationInfo.pin).length) {
    const upgradesByAffected: UpgradesByAffectedPackage = {};
    for (const topLevelPkg of Object.keys(remediationInfo.upgrade)) {
      for (const targetPkgStr of remediationInfo.upgrade[topLevelPkg].upgrades) {
        if (!upgradesByAffected[targetPkgStr]) {
          upgradesByAffected[targetPkgStr] = [];
        }
        upgradesByAffected[targetPkgStr].push({
          name: topLevelPkg,
          version: remediationInfo.upgrade[topLevelPkg].upgradeTo,
        });
      }
    }
    upgradeTextArray = constructPinText(remediationInfo.pin, upgradesByAffected, basicVulnInfo, options);
    const allVulnIds = new Set();
    Object.keys(remediationInfo.pin).forEach(
      (name) => remediationInfo.pin[name].issues.forEach((vid) => allVulnIds.add(vid)));
    remediationInfo.unresolved = remediationInfo.unresolved.filter((issue) => !allVulnIds.has(issue.id));
  } else {
    upgradeTextArray = constructUpgradesText(remediationInfo.upgrade, basicVulnInfo, options);
  }
  if (upgradeTextArray.length > 0) {
    results.push(upgradeTextArray.join('\n'));
  }

  const patchedTextArray = constructPatchesText(remediationInfo.patch, basicVulnInfo, options);

  if (patchedTextArray.length > 0) {
    results.push(patchedTextArray.join('\n'));
  }

  const unfixableIssuesTextArray = constructUnfixableText(remediationInfo.unresolved, basicVulnInfo, options);

  if (unfixableIssuesTextArray.length > 0) {
    results.push(unfixableIssuesTextArray.join('\n'));
  }

  const licenseIssuesTextArray = constructLicenseText(basicLicenseInfo, options);

  if (licenseIssuesTextArray.length > 0) {
    results.push(licenseIssuesTextArray.join('\n'));
  }

  return results;
}

export function getSeverityValue(severity: SEVERITY): number {
  return SEVERITIES.find((s) => s.verboseName === severity)!.value;
}

function constructLicenseText(
  basicLicenseInfo: {
    [name: string]: BasicVulnInfo;
  },
  testOptions: TestOptions,
): string[] {

  if (!(Object.keys(basicLicenseInfo).length > 0)) {
    return [];
  }

  const licenseTextArray = [chalk.bold.green('\nLicense issues:')];

  for (const id of Object.keys(basicLicenseInfo)) {

    const licenseText =
    formatIssue(
      id,
      basicLicenseInfo[id].title,
      basicLicenseInfo[id].severity,
      basicLicenseInfo[id].isNew,
      basicLicenseInfo[id].legalInstructions,
      `${basicLicenseInfo[id].name}@${basicLicenseInfo[id].version}`,
      basicLicenseInfo[id].paths,
      testOptions,
    );
    licenseTextArray.push('\n' + licenseText);
  }
  return licenseTextArray;
}

function constructPatchesText(
  patches: {
    [name: string]: PatchRemediation;
  },
  basicVulnInfo: {
    [name: string]: BasicVulnInfo;
  },
  testOptions: TestOptions,
): string[] {

  if (!(Object.keys(patches).length > 0)) {
    return [];
  }
  const patchedTextArray = [chalk.bold.green('\nPatchable issues:')];

  for (const id of Object.keys(patches)) {

    if (basicVulnInfo[id].type === 'license') {
      continue;
    }

    // todo: add vulnToPatch package name
    const packageAtVersion = `${basicVulnInfo[id].name}@${basicVulnInfo[id].version}`;
    const patchedText = `\n  Patch available for ${chalk.bold.whiteBright(packageAtVersion)}\n`;
    const thisPatchFixes = formatIssue(
      id,
      basicVulnInfo[id].title,
      basicVulnInfo[id].severity,
      basicVulnInfo[id].isNew,
      undefined,
      `${basicVulnInfo[id].name}@${basicVulnInfo[id].version}`,
      basicVulnInfo[id].paths,
      testOptions,
    );
    patchedTextArray.push(patchedText + thisPatchFixes);
  }

  return patchedTextArray;
}

function thisUpgradeFixes(vulnIds: string[], basicVulnInfo: Record<string, BasicVulnInfo>, testOptions: TestOptions) {
  return vulnIds
    .filter((id) => basicVulnInfo[id]) // basicVulnInfo only contains issues with the specified severity levels
    .sort((a, b) => getSeverityValue(basicVulnInfo[a].severity) - getSeverityValue(basicVulnInfo[b].severity))
    .filter((id) => basicVulnInfo[id].type !== 'license')
    .map((id) => formatIssue(
      id,
      basicVulnInfo[id].title,
      basicVulnInfo[id].severity,
      basicVulnInfo[id].isNew,
      undefined,
      `${basicVulnInfo[id].name}@${basicVulnInfo[id].version}`,
      basicVulnInfo[id].paths,
      testOptions,
    ))
    .join('\n');
}

function processUpgrades(
  sink: string[],
  upgradesByDep: DependencyUpdates | DependencyPins,
  deps: string[],
  basicVulnInfo: Record<string, BasicVulnInfo>,
  testOptions: TestOptions,
) {
  for (const dep of deps) {
    const data = upgradesByDep[dep];
    const upgradeDepTo = data.upgradeTo;
    const vulnIds = (data as UpgradeRemediation).vulns || (data as PinRemediation).issues;
    const upgradeText =
      `\n  Upgrade ${chalk.bold.whiteBright(dep)} to ${chalk.bold.whiteBright(upgradeDepTo)} to fix\n`;
    sink.push(upgradeText + thisUpgradeFixes(vulnIds, basicVulnInfo, testOptions));
  }
}

function constructUpgradesText(
  upgrades: DependencyUpdates,
  basicVulnInfo: {
    [name: string]: BasicVulnInfo;
  },
  testOptions: TestOptions,
): string[] {

  if (!(Object.keys(upgrades).length > 0)) {
    return [];
  }

  const upgradeTextArray = [chalk.bold.green('\nIssues to fix by upgrading:')];
  processUpgrades(upgradeTextArray, upgrades, Object.keys(upgrades), basicVulnInfo, testOptions);
  return upgradeTextArray;
}

function constructPinText(
  pins: DependencyPins,
  upgradesByAffected: UpgradesByAffectedPackage, // classical "remediation via top-level dep" upgrades
  basicVulnInfo: Record<string, BasicVulnInfo>,
  testOptions: TestOptions,
): string[] {

  if (!(Object.keys(pins).length)) {
    return [];
  }

  const upgradeTextArray: string[] = [];
  upgradeTextArray.push(chalk.bold.green('\nIssues to fix by upgrading dependencies:'));

  // First, direct upgrades

  const upgradeables = Object.keys(pins).filter((name) => !pins[name].isTransitive);
  if (upgradeables.length) {
    processUpgrades(upgradeTextArray, pins, upgradeables, basicVulnInfo, testOptions);
  }

  // Second, pins
  const pinables = Object.keys(pins).filter((name) => pins[name].isTransitive);

  if (pinables.length) {
    for (const pkgName of pinables) {
      const data = pins[pkgName];
      const vulnIds = data.issues;
      const upgradeDepTo = data.upgradeTo;
      const upgradeText =
        `\n  Pin ${chalk.bold.whiteBright(pkgName)} to ${chalk.bold.whiteBright(upgradeDepTo)} to fix`;
      upgradeTextArray.push(upgradeText);
      upgradeTextArray.push(thisUpgradeFixes(vulnIds, basicVulnInfo, testOptions));

      // Finally, if we have some upgrade paths that fix the same issues, suggest them as well.
      const topLevelUpgradesAlreadySuggested = new Set();
      for (const vid of vulnIds) {
        for (const topLevelPkg of upgradesByAffected[pkgName + '@' + basicVulnInfo[vid].version] || []) {
          const setKey = `${topLevelPkg.name}\n${topLevelPkg.version}`;
          if (!topLevelUpgradesAlreadySuggested.has(setKey)) {
            topLevelUpgradesAlreadySuggested.add(setKey);
            upgradeTextArray.push('  The issues above can also be fixed by upgrading top-level dependency ' +
              `${topLevelPkg.name} to ${topLevelPkg.version}`);
          }
        }
      }
    }
  }

  return upgradeTextArray;
}

function constructUnfixableText(unresolved: IssueData[], basicVulnInfo: Record<string, BasicVulnInfo>, testOptions: TestOptions) {
  if (!(unresolved.length > 0)) {
    return [];
  }
  const unfixableIssuesTextArray = [chalk.bold.white('\nIssues with no direct upgrade or patch:')];
  for (const issue of unresolved) {
    const issueInfo = basicVulnInfo[issue.id];
    if (!issueInfo) {
      // basicVulnInfo only contains issues with the specified severity levels
      continue;
    }

    const extraInfo = issue.fixedIn && issue.fixedIn.length
      ? `\n  This issue was fixed in versions: ${chalk.bold(issue.fixedIn.join(', '))}`
      : '\n  No upgrade or patch available';
    unfixableIssuesTextArray
      .push(formatIssue(
        issue.id,
        issue.title,
        issue.severity,
        issue.isNew,
        undefined,
        `${issue.packageName}@${issue.version}`,
        issueInfo.paths,
        testOptions,
      ) + `${extraInfo}`);
  }

  if (unfixableIssuesTextArray.length === 1) {
    // seems we still only have
    // the initial section title, so nothing to return
    return [];
  }

  return unfixableIssuesTextArray;
}

function printPath(path: string[]) {
  return path.slice(1).map((name, i) => chalk.cyan(name)).join(' > ');
}

function formatIssue(
  id: string,
  title: string,
  severity: SEVERITY,
  isNew: boolean,
  legalInstructions: string | undefined,
  vulnerableModule: string,
  paths: string[][],
  testOptions: TestOptions,
  ): string {
  const severitiesColourMapping = {
    low: {
      colorFunc(text) {
        return chalk.blueBright(text);
      },
    },
    medium: {
      colorFunc(text) {
        return chalk.yellowBright(text);
      },
    },
    high: {
      colorFunc(text) {
        return chalk.redBright(text);
      },
    },
  };
  const newBadge = isNew ? ' (new)' : '';
  const name = vulnerableModule ? ` in ${chalk.bold(vulnerableModule)}` : '';
  const wrapLegalText = wrap(`${legalInstructions}`, 100);
  const formatLegalText = wrapLegalText.split('\n').join('\n    ');

  let introducedBy = '';
  if (testOptions.showVulnPaths === 'some' && paths && paths.find((p) => p.length > 2)) {
    // In this mode, we show only one path by default, for compactness
    const pathStr = printPath(paths[0]);
    introducedBy = paths.length === 1
      ? `\n    introduced by ${pathStr}`
      : `\n    introduced by ${pathStr} and ${chalk.cyanBright('' + (paths.length - 1))} other path(s)`;
  } else if (testOptions.showVulnPaths === 'all' && paths) {
    introducedBy = `\n    introduced by:` + paths.slice(0, 1000).map((p) => `\n    ` + printPath(p)).join('');
    if (paths.length > 1000) {
      introducedBy += `\n    and ${chalk.cyanBright('' + (paths.length - 1))} other path(s)`
    }
  }

  return severitiesColourMapping[severity].colorFunc(
    `  ✗ ${chalk.bold(title)}${newBadge} [${titleCaseText(severity)} Severity]`,
  ) + `[${config.ROOT}/vuln/${id}]` + name
    + introducedBy
    + (legalInstructions ? `${chalk.bold('\n    Legal instructions')}:\n    ${formatLegalText}` : '');
}

function titleCaseText(text) {
  return text[0].toUpperCase() + text.slice(1);
}
