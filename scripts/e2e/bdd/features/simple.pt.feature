# language: pt
@simple-mode
Funcionalidade: Modo simples
  Quem nunca abre um terminal começa uma tarefa, responde uma pergunta simples e recebe um arquivo.

  Cenário: Começar uma tarefa, responder sim e ver o resultado
    Dado que o modo simples está ligado em "alfa"
    Quando começo a tarefa "Escrever um resumo" na pasta de notas
    E respondo sim à pergunta
    Então a tarefa termina
    E o arquivo "summary.md" aparece entre os arquivos da tarefa

  Cenário: Mostrar o app completo e voltar
    Dado que o modo simples está ligado em "alfa"
    Quando escolho mostrar tudo nas configurações
    Então o app completo aparece
    Quando volto ao modo simples pela página do host "alfa"
    Então o início do modo simples aparece
