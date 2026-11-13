import { useState } from 'react';
import { ArrowRight, Check, Calculator, Smartphone, ShieldCheck } from 'lucide-react';
import { formatBRL, formatPercent } from '../types/garage';

interface LandingPageProps {
  navigate: (to: string) => void;
}

export function LandingPage({ navigate }: LandingPageProps) {
  const [compra, setCompra] = useState(68000);
  const [despesas, setDespesas] = useState(3450);
  const [venda, setVenda] = useState(82900);

  const custoTotal = compra + despesas;
  const lucro = venda - custoTotal;
  const margem = venda > 0 ? lucro / venda : 0;

  return (
    <div className="min-h-screen bg-white text-slate-900 flex flex-col">
      {/* Top Bar Contract: 3 zones (Wordmark — 4 Links — 1 Primary CTA) */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-8">
          <button
            type="button"
            onClick={() => navigate('/')}
            className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
          >
            CS22 Garage
          </button>

          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
            <a href="#fluxo" className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0">
              Como funciona
            </a>
            <a href="#calculadora" className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0">
              Calculadora
            </a>
            <a href="#precos" className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0">
              Preços
            </a>
            <button
              type="button"
              onClick={() => navigate('/g/premium-motors')}
              className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
            >
              Vitrine demo
            </button>
          </nav>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => navigate('/login')}
              className="hidden sm:inline-flex px-3 py-2 text-sm font-medium text-slate-700 hover:text-slate-900 whitespace-nowrap shrink-0"
            >
              Entrar
            </button>
            <button
              type="button"
              onClick={() => navigate('/cadastro')}
              className="min-h-[40px] px-4 py-2 text-xs sm:text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              Testar 7 dias grátis
            </button>
          </div>
        </div>
      </header>

      {/* Hero Split */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-12 lg:py-20 w-full">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-stretch">
          <div className="lg:col-span-6 flex flex-col justify-center">
            <p className="text-xs font-medium text-slate-500 mb-3">
              Gestão enxuta para garagens e revendas independentes
            </p>
            <h1 className="font-display text-3xl sm:text-4xl lg:text-[2.75rem] font-extrabold tracking-tight text-slate-900 leading-[1.12] [text-wrap:balance]">
              Uma vitrine no link da bio e o lucro real de cada carro vendido.
            </h1>
            <p className="mt-5 text-base text-slate-600 leading-relaxed max-w-xl">
              Pare de anotar mecânica, estética e comissão no caderno ou no WhatsApp. Cadastre o veículo pelo celular,
              publique sua página própria e descubra exatamente quanto cada venda colocou no bolso.
            </p>

            <div className="mt-8 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              <button
                type="button"
                onClick={() => navigate('/cadastro')}
                className="min-h-[48px] px-6 py-3 bg-blue-700 hover:bg-blue-800 text-white text-sm font-semibold rounded-xl transition-colors flex items-center justify-center gap-2 whitespace-nowrap"
              >
                <span>Criar conta sem cartão</span>
                <ArrowRight className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => navigate('/g/premium-motors')}
                className="min-h-[48px] px-5 py-3 bg-slate-100 hover:bg-slate-200 text-slate-800 text-sm font-semibold rounded-xl transition-colors text-center whitespace-nowrap"
              >
                Ver vitrine de exemplo
              </button>
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-500">
              <span>7 dias grátis sem cartão</span>
              <span aria-hidden="true">·</span>
              <span>Funciona no celular</span>
              <span aria-hidden="true">·</span>
              <span>Vitrine /g/sua-garagem</span>
            </div>
          </div>

          <div className="lg:col-span-6">
            <div className="h-full min-h-[260px] lg:min-h-[400px] rounded-2xl overflow-hidden border border-slate-200 bg-slate-100">
              <img
                src="/src/assets/images/hero_garage_showroom_1794570998522.jpg"
                alt="Showroom moderno de veículos seminovos"
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover"
              />
            </div>
          </div>
        </div>
      </section>

      {/* 4-Step Mechanism Flow */}
      <section id="fluxo" className="bg-slate-50 border-y border-slate-200 py-14 lg:py-20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="max-w-2xl">
            <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
              Comprar, anunciar, vender e medir em um único dia pelo celular.
            </h2>
            <p className="mt-2.5 text-sm sm:text-base text-slate-600">
              Sem planilhas paralelas e sem telas complicadas. Só os números que o dono da garagem olha toda semana.
            </p>
          </div>

          <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              {
                num: '01. Cadastre o carro',
                desc: 'Informe compra, placa (privada só para você), preço anunciado e até 10 fotos comprimidas direto do celular.',
              },
              {
                num: '02. Publique na bio',
                desc: 'Seu link /g/sua-garagem já nasce com busca, filtro de ano e preço, pré-visualização no WhatsApp e botão direto.',
              },
              {
                num: '03. Lance as despesas',
                desc: 'Mecânica, funilaria, estética, pneus, documentação e comissão entram no custo do veículo sem duplicidade.',
              },
              {
                num: '04. Venda e veja o lucro',
                desc: 'Ao registrar a venda, o carro sai da vitrine na hora e você vê CMV, lucro líquido, margem e dias em estoque.',
              },
            ].map((step) => (
              <div key={step.num} className="bg-white border border-slate-200 rounded-xl p-6">
                <h3 className="font-display text-base font-bold text-slate-900">{step.num}</h3>
                <p className="mt-2 text-sm text-slate-600 leading-relaxed">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Interactive Profit Calculator Hook */}
      <section id="calculadora" className="py-14 lg:py-20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
            <div className="lg:col-span-5">
              <div className="inline-flex items-center gap-2 text-xs font-semibold text-blue-700 mb-2">
                <Calculator className="w-4 h-4" />
                <span>Simulador de lucro por veículo</span>
              </div>
              <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 [text-wrap:balance]">
                Quanto sobrou de verdade no último carro que você vendeu?
              </h2>
              <p className="mt-3 text-sm sm:text-base text-slate-600 leading-relaxed">
                Muita garagem olha só a diferença entre compra e venda e esquece pneu, funilaria, documentação e comissão.
                No CS22 Garage, cada gasto soma automaticamente no CMV do carro.
              </p>
              <div className="mt-6 space-y-2.5 text-sm text-slate-700">
                <div className="flex items-center gap-2.5">
                  <Smartphone className="w-4 h-4 text-blue-700 shrink-0" />
                  <span>Painel mostra dinheiro parado e carros há mais de 60 dias</span>
                </div>
                <div className="flex items-center gap-2.5">
                  <ShieldCheck className="w-4 h-4 text-blue-700 shrink-0" />
                  <span>Placa, valor de compra e despesas nunca aparecem na vitrine</span>
                </div>
              </div>
            </div>

            <div className="lg:col-span-7 bg-slate-50 border border-slate-200 rounded-2xl p-6 sm:p-8">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1.5">Valor de compra (R$)</label>
                  <input
                    type="number"
                    min={0}
                    step={500}
                    value={compra}
                    onChange={(e) => setCompra(Number(e.target.value) || 0)}
                    className="w-full h-11 px-3 bg-white border border-slate-300 rounded-lg text-sm font-mono tabular-nums text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-700"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1.5">Despesas totais (R$)</label>
                  <input
                    type="number"
                    min={0}
                    step={100}
                    value={despesas}
                    onChange={(e) => setDespesas(Number(e.target.value) || 0)}
                    className="w-full h-11 px-3 bg-white border border-slate-300 rounded-lg text-sm font-mono tabular-nums text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-700"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1.5">Valor de venda (R$)</label>
                  <input
                    type="number"
                    min={0}
                    step={500}
                    value={venda}
                    onChange={(e) => setVenda(Number(e.target.value) || 0)}
                    className="w-full h-11 px-3 bg-white border border-slate-300 rounded-lg text-sm font-mono tabular-nums text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-700"
                  />
                </div>
              </div>

              <div className="mt-6 pt-6 border-t border-slate-200 grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <p className="text-xs text-slate-500">Custo total (CMV)</p>
                  <p className="mt-1 font-mono text-lg font-semibold tabular-nums text-slate-900">
                    {formatBRL(custoTotal)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Lucro real</p>
                  <p
                    className={`mt-1 font-mono text-lg font-bold tabular-nums ${
                      lucro >= 0 ? 'text-emerald-700' : 'text-red-700'
                    }`}
                  >
                    {formatBRL(lucro)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Margem líquida</p>
                  <p className="mt-1 font-mono text-lg font-semibold tabular-nums text-slate-900">
                    {formatPercent(margem)}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section id="precos" className="bg-slate-50 border-t border-slate-200 py-14 lg:py-20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="max-w-xl">
            <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
              Preço direto, sem comissão por carro vendido.
            </h2>
            <p className="mt-2 text-sm sm:text-base text-slate-600">
              Teste completo por 7 dias sem cadastrar cartão. Depois, pague via Pix, boleto ou cartão no Asaas.
            </p>
          </div>

          <div className="mt-10 grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-white border border-slate-200 rounded-2xl p-6 flex flex-col">
              <p className="text-xs font-semibold text-blue-700">Para as 20 primeiras garagens</p>
              <h3 className="mt-1 font-display text-lg font-bold text-slate-900">Garagem Fundadora</h3>
              <p className="mt-4 font-mono text-3xl font-bold tabular-nums text-slate-900">
                R$ 39,90<span className="text-sm font-sans font-normal text-slate-500">/mês</span>
              </p>
              <p className="mt-1 text-xs text-slate-500">Valor travado por 12 meses</p>
              <ul className="mt-6 space-y-2.5 text-sm text-slate-600 flex-1">
                <li className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-emerald-700 shrink-0" />
                  <span>Vitrine pública /g/sua-garagem</span>
                </li>
                <li className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-emerald-700 shrink-0" />
                  <span>Veículos, fotos e despesas ilimitados</span>
                </li>
                <li className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-emerald-700 shrink-0" />
                  <span>Painel de lucro real e estoque parado</span>
                </li>
              </ul>
              <button
                type="button"
                onClick={() => navigate('/cadastro')}
                className="mt-6 w-full min-h-[44px] px-4 py-2.5 bg-blue-700 hover:bg-blue-800 text-white text-sm font-semibold rounded-xl transition-colors"
              >
                Garantir vaga fundadora
              </button>
            </div>

            <div className="bg-white border border-slate-900 rounded-2xl p-6 flex flex-col">
              <p className="text-xs font-semibold text-slate-500">Plano padrão</p>
              <h3 className="mt-1 font-display text-lg font-bold text-slate-900">Mensal</h3>
              <p className="mt-4 font-mono text-3xl font-bold tabular-nums text-slate-900">
                R$ 59,90<span className="text-sm font-sans font-normal text-slate-500">/mês</span>
              </p>
              <p className="mt-1 text-xs text-slate-500">Cancele quando quiser</p>
              <ul className="mt-6 space-y-2.5 text-sm text-slate-600 flex-1">
                <li className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-emerald-700 shrink-0" />
                  <span>7 dias de teste grátis sem cartão</span>
                </li>
                <li className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-emerald-700 shrink-0" />
                  <span>Até 10 fotos comprimidas por carro</span>
                </li>
                <li className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-emerald-700 shrink-0" />
                  <span>Contadores de visualizações e WhatsApp</span>
                </li>
              </ul>
              <button
                type="button"
                onClick={() => navigate('/cadastro')}
                className="mt-6 w-full min-h-[44px] px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold rounded-xl transition-colors"
              >
                Começar 7 dias grátis
              </button>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-6 flex flex-col">
              <p className="text-xs font-semibold text-slate-500">Economia de 2 meses</p>
              <h3 className="mt-1 font-display text-lg font-bold text-slate-900">Anual</h3>
              <p className="mt-4 font-mono text-3xl font-bold tabular-nums text-slate-900">
                R$ 599<span className="text-sm font-sans font-normal text-slate-500">/ano</span>
              </p>
              <p className="mt-1 text-xs text-slate-500">Equivalente a R$ 49,91/mês</p>
              <ul className="mt-6 space-y-2.5 text-sm text-slate-600 flex-1">
                <li className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-emerald-700 shrink-0" />
                  <span>Tudo do plano mensal incluso</span>
                </li>
                <li className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-emerald-700 shrink-0" />
                  <span>Pagamento único via Pix, boleto ou cartão</span>
                </li>
                <li className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-emerald-700 shrink-0" />
                  <span>Histórico preservado e auditoria de vendas</span>
                </li>
              </ul>
              <button
                type="button"
                onClick={() => navigate('/cadastro')}
                className="mt-6 w-full min-h-[44px] px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-900 text-sm font-semibold rounded-xl transition-colors"
              >
                Testar antes de assinar
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Quiet Footer */}
      <footer className="bg-white border-t border-slate-200 py-8">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500">
          <div className="flex items-center gap-4">
            <span className="font-display font-bold text-slate-900 text-sm">CS22 Garage</span>
            <span>Vitrine e lucro real por veículo</span>
          </div>
          <div className="flex items-center gap-5">
            <button type="button" onClick={() => navigate('/login')} className="hover:text-slate-900">
              Entrar no painel
            </button>
            <button type="button" onClick={() => navigate('/g/premium-motors')} className="hover:text-slate-900">
              Vitrine demo
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
