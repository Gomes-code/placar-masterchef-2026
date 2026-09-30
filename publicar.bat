@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo === 1/3 Lendo as planilhas da pasta Dados ===
py scripts\extrair_dados.py || (echo ERRO ao ler as planilhas. Alguma esta aberta no Excel? Salve e feche. & pause & exit /b 1)
echo.
echo === 2/3 Salvando versao (commit) ===
git add -A
git commit -m "Atualiza resultados %date%" || echo Nada mudou desde a ultima publicacao.
echo.
echo === 3/3 Enviando para o GitHub ===
git push || (echo ERRO no envio. Verifique a internet/login do GitHub. & pause & exit /b 1)
echo.
echo Pronto! O site atualiza em 1-2 minutos.
pause
