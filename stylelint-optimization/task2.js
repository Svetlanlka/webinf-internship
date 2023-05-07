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
              fileContent = insert(fileContent, '\n/* stylelint-disable ' + ignoreRules.slice(1).join(',') + ' */', lineIndex);
            } else if (ignoreRules[0] === 2) {
              fileContent = insert(fileContent, '\n/* stylelint-enable ' + ignoreRules.slice(1).join(',') + ' */', lineIndex);
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
  const classRules = ['selector-class-pattern', 'selector-pseudo-class-no-unknown', 'selector-not-notation'];
  const propertyRules = ['custom-property-pattern', 'alpha-value-notation', 'color-function-notation'];

  warnings.forEach((warn)=>{
    let lineIndex = warn.line === 1 ? 0 : findSymPosInStr(fileContent, '\n', warn.line - 1);
    lineIndex = checkRuleTransfer(fileContent, lineIndex);

    let ruleIsAdd = false;
    if (warn.rule === descRule) {
      const {pos1, pos2} = getPosForDescendingRule(fileContent, lineIndex);
      ignoreWarnLines.set(pos1, addToArrInMap(ignoreWarnLines, pos1, warn.rule, 1));
      ignoreWarnLines.set(pos2, addToArrInMap(ignoreWarnLines, pos2, warn.rule, 2));
      ruleIsAdd = true;
    }
    if (classRules.includes(warn.rule)) {
      const {useBlock, pos1: p1, pos2: p2} = getPosForSelectorClassRule(fileContent, lineIndex);
      if (useBlock) {
        ignoreWarnLines.set(p1, addToArrInMap(ignoreWarnLines, p1, warn.rule, 1));
        ignoreWarnLines.set(p2, addToArrInMap(ignoreWarnLines, p2, warn.rule, 2));
        ruleIsAdd = true;
      }
    }
    if (propertyRules.includes(warn.rule)) {
      const {useBlock: useBlock2, pos1: p11, pos2: p22} = getPosForCustomPropertyRule(fileContent, lineIndex);
      if (useBlock2) {
        ignoreWarnLines.set(p11, addToArrInMap(ignoreWarnLines, p11, warn.rule, 1));
        ignoreWarnLines.set(p22, addToArrInMap(ignoreWarnLines, p22, warn.rule, 2));
        ruleIsAdd = true;
      }
    }

    if (!ruleIsAdd && lineIndex !== -1) {
      ignoreWarnLines.set(lineIndex, addToArrInMap(ignoreWarnLines, lineIndex, warn.rule));
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

  if (commaCount > 0) {
    pos.useBlock = true;
  }

  return pos;
}

// отключение правил вида custom-property-pattern нарушают синтаксис css, если свойство расположено на нескольких строках,
// поэтому для свойств на нескольких строках будем отключать блоки кода
function getPosForCustomPropertyRule(str, curPos) {
  const pos = {useBlock: false, pos1: curPos, pos2: curPos + 1};
  let endLineCount = 0;

  let j = pos.pos2;
  for (; j < str.length; j++) {
    if (str[j] === ';') {
      pos.pos2 = (j + 1);
      break;
    }
  }
  for (let i = j; i >= 0; i--) {
    if (str[i] === ':') {
      for (let k = i - 1; k >= 0; k--) {
        if (str[k] === '\n') {
          pos.pos1 = k;
          break;
        }
      }
      break;
    }
    if (str[i] === '\n') {
      endLineCount++;
    }
  }

  if (endLineCount > 0) {
    pos.useBlock = true;
  }

  return pos;
}

function addToArrInMap(map, key, value, blockPos = 0) {
  const arr = map.get(key);

  if (arr) {
    if (!arr.includes(value)) {
      arr.push(value);
    }
    return arr;
  } else {
    if (blockPos) {
      return [blockPos, value];
    } else {
      return [value];
    }
  }
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