## Задание

[Репозиторий с заданием](https://github.com/mkraynov/webinf-internship)

Перед решением задания были добавлены пакеты glob и ignore (строки 29 и 32 package.json)

## Решение задания 1

Решением задания является скрипт stylelint-optimization/task1.js
Для оптимизации stylelintignore были произведены следующие действия:
1. Удовлетворяющие .stylelintignore пути файлов были отфильтрованы:
   - если в игнорируемом файле есть правило, отключающее линтинг на весь файл, то путь файла не учитывается
   - если в игнорируемом файле нет ошибок, то путь файла не учитывается
2. По списку отфильтрованных файлов были отфильтрованы правила:
   - если нет подходящих под правило из stylelintgnore файлов - удалить строку с этим правилом из stylelintignore
   - если одно правило из stylelintignore покрывает другое, то удалить строку с покрываемым правилом (все файлы для покрываемого правила есть в том, которое его покрывает, например: правило folder/*.css покрывает правила folder/a.css и folder/b.css).

## Решение задания 2

Решением задания является скрипт stylelint-optimization/task2.js
Были произведены следующие действия:
- получены все пути файлов, удовлетворяющие правилам .stylelintignore
- для каждого файла вставлены директивы /* stylelint-disable-next-line **rulesList** */
- файлы с отключенным на весь файл линтингом не меняются