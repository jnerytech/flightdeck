/** Os dispositivos que aprovam pela pessoa, na página de um host (#3439). */
export const approval = {
  approvalDevices: {
    title: "Dispositivos que aprovam",
    hint: "Uma permissão de risco alto, ou que salva uma regra, é assinada por um dispositivo cadastrado aqui. Sem nenhum, segurar o botão é a única checagem.",
    off: "Proteção desligada: nenhum dispositivo cadastrado neste host.",
    on: "Proteção ligada: estes dispositivos podem aprovar.",
    listLabel: "Dispositivos cadastrados",
    thisDevice: "Este dispositivo",
    elsewhere: "Outro dispositivo",
    detail: "{client} · {address} · cadastrado em {date}",
    revoke: "Revogar",
    revokeLabel: "Revogar {name}",
    revoked: "Dispositivo revogado.",
    enrollTitle: "Cadastrar este dispositivo",
    enrollHint:
      "No terminal do host, rode flightdeckd approvers enroll e digite o código que ele mostra. O código vale uma vez, por dez minutos.",
    nameLabel: "Nome deste dispositivo",
    codeLabel: "Código de uso único",
    enroll: "Cadastrar",
    enrolled: "Este dispositivo está cadastrado.",
    removeLocal: "Remover a chave deste dispositivo",
    removeLocalHint:
      "O host continua listando o dispositivo até outro dispositivo cadastrado revogá-lo, ou até você zerar no host.",
    removedLocal: "A chave deste dispositivo foi removida.",
    lost: "A proteção estava ligada e o host agora não lista nenhum dispositivo. Se você não zerou no host, alguém com acesso a ele zerou.",
    scope:
      "Isto protege as aprovações feitas pelo app. Quem tem um terminal no host ainda pode zerar.",
    loading: "Lendo os dispositivos do host…",
    retry: "Tentar de novo",
    loadFailed: "Não foi possível ler os dispositivos do host.",
    noKeyHere:
      "Este dispositivo não tem chave de aprovação neste host. Aprove por um dispositivo que tenha uma, ou zere a proteção no terminal do host com flightdeckd approvers reset e cadastre este dispositivo de novo.",
    hasKeyHere: "Este dispositivo já tem uma chave para este host.",
    addTitle: "Adicionar outro dispositivo",
    addHint:
      "No novo dispositivo, abra a página deste host, escolha “Mostrar o texto” e cole aqui o que ele mostra. Uma janela do sistema pede então a sua confirmação.",
    addTextLabel: "Texto do novo dispositivo",
    addRead: "Ler",
    addOfferTitle: "Adicionar este dispositivo?",
    addOfferFor: "Dispositivo “{name}”, para o host {host}.",
    addOfferCode: "Código:",
    addOfferHint:
      "Adicione só se o novo dispositivo mostrar o mesmo código. O nome é só um rótulo; o código é o que mostra que é o mesmo dispositivo.",
    addConfirm: "Adicionar este dispositivo",
    addCancel: "Cancelar",
    addDone: "O dispositivo foi adicionado.",
    addDeclined: "Nada foi alterado.",
    requestTitle: "Adicionar este dispositivo a este host",
    requestHint:
      "Gere um texto aqui e cole em um dispositivo já cadastrado, na página deste host. Esse dispositivo mostra o mesmo código antes de adicionar este.",
    requestShow: "Mostrar o texto",
    requestTextLabel: "Texto para o dispositivo já cadastrado",
    requestWaiting: "Aguardando o outro dispositivo adicionar este.",
    requestCheck: "Verificar de novo",
    addBadText:
      "Isso não é um texto gerado pelo botão de adicionar de outro dispositivo. Copie de novo, inteiro.",
    addOtherHost:
      "Esse texto foi feito para outro host. Gere de novo no dispositivo, com este host aberto.",
    addBadName: "O nome tem de 1 a 64 caracteres, sem caracteres ocultos, e não é um código.",
    addAlready: "Esse dispositivo já está cadastrado neste host.",
  },
};
