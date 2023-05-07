'use strict';

const fs = require('fs-extra');
const ignore = require('ignore');
const stylelint = require('stylelint');
const path = require('path');
const glob = require('glob');

// запуск для корневой папки
InsertIgnoreLintRulesInfiles('.');

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
          const ignoreWarnLines = getIgnoreWarningsLinesPos(result.warnings, fileContent);
          const sortIgnoreWarnLines = new Map([...ignoreWarnLines].sort((l1, l2)=>(l2[0]-l1[0])));

          sortIgnoreWarnLines.forEach((ignoreRules, lineIndex) => {
            if (ignoreRules[0] === 1) {
              fileContent = insert(fileContent, '\n/* stylelint-disable ' + ignoreRules[1] + ' */', lineIndex);
            } else if (ignoreRules[0] === 2) {
              fileContent = insert(fileContent, '\n/* stylelint-enable ' + ignoreRules[1] + ' */', lineIndex);
            } else {
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

// формирование массива с вставляемыми в одну строку игнорируемыми правилами
// результат: объект для которого ключ - номер строки, значение - массив игнорируемых правил
function getIgnoreWarningsLinesPos(warnings, fileContent) {
  const ignoreWarnLines = new Map();
  const descRule = 'no-descending-specificity';
  const classRule = 'selector-class-pattern';

  warnings.forEach((warn)=>{
    let lineIndex = warn.line === 1 ? 0 : findSymPosInStr(fileContent, '\n', warn.line - 1);
    lineIndex = checkRuleTransfer(fileContent, lineIndex);

    let ruleIsAdd = false;
    if (warn.rule === descRule) {
      const {pos1, pos2} = getPosForDescendingRule(fileContent, lineIndex);
      ignoreWarnLines.set(pos1, [1, descRule]);
      ignoreWarnLines.set(pos2, [2, descRule]);
      ruleIsAdd = true;
    }
    if (warn.rule === classRule) {
      const {useBlock, pos1: p1, pos2: p2} = getPosForSelectorClassRule(fileContent, lineIndex);
      if (useBlock) {
        ignoreWarnLines.set(p1, [1, classRule]);
        ignoreWarnLines.set(p2, [2, classRule]);
        ruleIsAdd = true;
      }
    }

    let oldRules = ignoreWarnLines.get(lineIndex);
    if (oldRules) {
      if (!oldRules.includes(warn.rule)) {
        oldRules.push(warn.rule);
      }
    }

    if (!ruleIsAdd && lineIndex !== -1) {
      ignoreWarnLines.set(lineIndex, oldRules || [warn.rule])
    }
  })

  return ignoreWarnLines;
}

// правила вида no-descending-specificity должны быть отключены не для одной линии, а для нескольких, представляющих собой одно css-правило,
// для которого селекторы расположены на нескольких строках,
// поэтому отключим блок кода, с помощью stylelint-disable/enable
// позиции вставки которого - конец предыдущего правила (или нулевая позиция) и начало текущего
function getPosForDescendingRule(str, curPos) {
  const pos = {pos1: curPos, pos2: curPos + 1};

  for (let i = pos.pos1; i >= 0; i--) {
    if (str[i] === '}') {
      pos.pos1 = (i + 1);
      break;
    }
  }
  for (let j = pos.pos2; j < str.length; j++) {
    if (str[j] === '{') {
      pos.pos2 = (j + 1);
      break;
    }
  }

  return pos;
}

// правила вида selector-class-pattern не могут быть отключены с помощью disable-next-line для css-правил, размещенных на 3х и более строках,
// поэтому в таких случаем будем также отключать блоки кода
function getPosForSelectorClassRule(str, curPos) {
  const pos = {useBlock: false, pos1: curPos, pos2: curPos + 1};
  let commaCount = 0;

  for (let i = pos.pos1; i >= 0; i--) {
    if (str[i] === ',') {
      commaCount++;
    }
    if (str[i] === '}') {
      pos.pos1 = (i + 1);
      break;
    }
  }
  for (let j = pos.pos2; j < str.length; j++) {
    if (str[j] === ',') {
      commaCount++;
    }
    if (str[j] === '{') {
      pos.pos2 = (j + 1);
      break;
    }
  }

  if (commaCount > 1) {
    pos.useBlock = true;
  }

  return pos;
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

// для css-правил, перечисленных через запятую и размещенных на нескольких строках,
// директивы вставляются после запятой каждого предыдущего правила (чтобы исключить перенос строки, нарушающий синтаксис css)
function checkRuleTransfer(str, pos) {
  for (var i = pos - 1; i > 0; i--) {
    if (str[i] === ',' || str[i] === ')') {
      return (i + 1);
    }
    if (str[i] === ' ' || str[i] === '\t' || str[i] === '\r' || str[i] === '\v' || str[i] === '\f') {
      continue;
    }
    break;
  }

  return pos;
}