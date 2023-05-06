'use strict';

const fs = require('fs-extra');
const ignore = require('ignore');
const stylelint = require('stylelint');
const path = require('path');
const glob = require('glob');

async function InsertIgnoreLintRulesInfiles(baseDir) {
  const allFiles = glob.sync('**/*.css');

  const stylelintrcPath = path.join(baseDir, '.stylelintrc.json');
  const useStylelintrc = await fs.pathExists(stylelintrcPath);
  const stylelintrcContent = useStylelintrc ? JSON.parse(await fs.readFile(stylelintrcPath, 'utf8')) : {extends: 'stylelint-config-standard'};
  
  try {
    const stylelintignoreContent = await fs.readFile(path.join(baseDir, '.stylelintignore'), 'utf8');
    const ignoreRules = stylelintignoreContent.split('\n').map((f)=>f.trim());
    const ig = ignore().add(ignoreRules);

    // все файлы, попадающие под действие .stylelintignore
    const filesPaths = allFiles.filter(filePath =>ig.ignores(path.relative(baseDir, filePath)));
    
    fs.writeFile('.stylelintignore', '');
    const res = await stylelint.lint({
      config: stylelintrcContent,
      files: filesPaths,
      allowEmptyInput: true,
    });

    if (res.results.length > 0) {
      res.results.forEach((result, index) => {
        if (result.warnings.length > 0) {
          let fileContent = fs.readFileSync(path.join(baseDir, filesPaths[index]), 'utf8');
          const ignoreWarnLines = getIgnoreWarningsLines(result.warnings);

          ignoreWarnLines.forEach((ignoreRules, lineNumber) => {
            const lineIndex = lineNumber === 1 ? 0 : findSymPosInStr(fileContent, '\n', lineNumber - 1);

            if (lineIndex !== -1) {
              fileContent = insert(fileContent, '/* stylelint-disable-next-line ' + ignoreRules.join(', ') + ' */' + (lineIndex === 0? '\n': ''), lineIndex);
            }
          })

          fs.writeFile(filesPaths[index], fileContent);
        }
      });
    }


    fs.writeFile('.stylelintignore', stylelintignoreContent);
  } catch (e) {
    console.error('error of read stylelintignore: ', e)
  }
}

// запуск для корневой папки
InsertIgnoreLintRulesInfiles('.');

// формирование массива с вставляемыми в одну строку игнорируемыми правилами
// результат: объект для которого ключ - номер строки, значение - массив игнорируемых правил
function getIgnoreWarningsLines(warnings) {
  const ignoreWarnLines = new Map();

  warnings.forEach((warn)=>{
    let oldRules = ignoreWarnLines.get(warn.line);
    if (oldRules) {
      if (!oldRules.includes(warn.rule)) {
        oldRules.push(warn.rule);
      }
    }

    ignoreWarnLines.set(warn.line, oldRules || [warn.rule])
  })

  return ignoreWarnLines;
}

// вставка строки в строку, в позицию pos
function insert(str, substr, pos) {
  var array = str.split('');
  array.splice(pos, 0, substr);
  return array.join('');
}

// поиск p-того вхождения символа в строке
function findSymPosInStr(str, sym, p) {
  let posNumber = 1;

  for (let i = 0; i < str.length; i++) {
    if (str[i] === sym && posNumber === p) {
      return i;
    } else if (str[i] === sym) {
      posNumber++;
    }
  }

  return -1;
}