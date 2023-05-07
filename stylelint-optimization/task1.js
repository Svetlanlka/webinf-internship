'use strict';

const fs = require('fs-extra');
const ignore = require('ignore');
const stylelint = require('stylelint');
const path = require('path');
const glob = require('glob');

// запуск для корневой папки
ReduceStylelintignore('.');

async function ReduceStylelintignore(baseDir) {
  const allFiles = glob.sync('**/*.css');

  const stylelintrcPath = path.join(baseDir, '.stylelintrc.json');
  const useStylelintrc = await fs.pathExists(stylelintrcPath);
  const stylelintrcContent = useStylelintrc ? JSON.parse(await fs.readFile(stylelintrcPath, 'utf8')) : {extends: 'stylelint-config-standard'};
  
  let rulesFilesPaths = [];
  try {
    const stylelintignoreContent = await fs.readFile(path.join(baseDir, '.stylelintignore'), 'utf8');
    fs.writeFile('.stylelintignore', '');
    const ignoreRules = stylelintignoreContent.split('\n').map((f)=>f.trim());

    const ig = ignore().add(ignoreRules);
    const filesPaths = allFiles.filter(filePath =>ig.ignores(path.relative(baseDir, filePath)));

    const res = await stylelint.lint({
      config: stylelintrcContent,
      files: filesPaths,
      allowEmptyInput: true,
    });

    // пути только к тем файлам, в которых есть ошибки и в которых не отключен линтинг на весь файл
    const filterFilesPaths = [];
    if (res.results.length > 0) {
      res.results.forEach((result, index) => {
        if (result.warnings.length > 0) {
          filterFilesPaths.push(filesPaths[index]);
        }
      });
    }

    // формируется массив, каждый элемент которого это объект с названием правила и подходящими под него путями файлов (пути файлов уже отфильтрованы)
    // в массив добавляются только элементы, в которых правилам удовлетворяет хотя бы 1 файл
    ignoreRules.forEach((rule)=>{
      const igOneRule = ignore().add(rule);

      const ruleFilesPaths = filterFilesPaths.filter(filePath =>igOneRule.ignores(path.relative(baseDir, filePath)));
      if (ruleFilesPaths.length > 0) {
        rulesFilesPaths.push({paths: ruleFilesPaths, rule: rule});
      }
    });

    // из массива удаляются правила, покрывающиеся другими правилами; итоговый массив записывается в .stylelintignore
    fs.writeFile('.stylelintignore', RemoveRulesCoveredByOthers(rulesFilesPaths).join('\n'));
  } catch (e) {
    console.error('error of read stylelintignore: ', e)
  }
}

// функция, удаляющая покрываемые правила
function RemoveRulesCoveredByOthers(rulesFilesPaths) {
  if (rulesFilesPaths.length === 0) return []; 

  const resultRules = [];
  const sortRulesFilesPaths = rulesFilesPaths.sort((r1, r2)=>r1.paths.length - r2.paths.length)

  for (let i = 0; i < sortRulesFilesPaths.length; i++) {
    let allfilesExistInOtherRule = true;

    for (let filePath of sortRulesFilesPaths[i].paths) {
      let fileExistInOtherRule = false;

      for (let j = i + 1; j < sortRulesFilesPaths.length; j++) {
        if (sortRulesFilesPaths[j].paths.includes(filePath)) {
          fileExistInOtherRule = true;
          break;
        }
      }
      if (!fileExistInOtherRule) {
        allfilesExistInOtherRule = false;
        break;
      }
    }

    if (!allfilesExistInOtherRule) {
      resultRules.push(sortRulesFilesPaths[i].rule);
    }
  }

  return resultRules;
}