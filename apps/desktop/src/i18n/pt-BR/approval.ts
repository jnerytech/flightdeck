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
  },
};
