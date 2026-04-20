import express from 'express';
import { db } from '../firebase-admin.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

/**
 * Verifica o limite de solicitações do usuário no mês atual.
 */
async function verificarLimiteMensal(userId) {
    const inicioMes = new Date();
    inicioMes.setDate(1);
    inicioMes.setHours(0, 0, 0, 0);

    // Consulta simples (sem índice)
    const snapshot = await db.collection('solicitacoes')
        .where('solicitanteId', '==', userId)
        .get();

    if (snapshot.empty) {
        return 0;
    }

    const statusAtivos = ['pendente', 'aprovada', 'coletada'];
    let contagem = 0;

    // Filtra os resultados em JAVASCRIPT
    snapshot.forEach(doc => {
        const sol = doc.data();
        const criadoEmDate = new Date(sol.criadoEm); 

        // Checa as condições manualmente
        if (statusAtivos.includes(sol.status) && criadoEmDate >= inicioMes) {
            contagem++;
        }
    });

    return contagem;
}

// Criar solicitação
router.post('/', requireAuth, async (req, res) => {
    try {
        const { itemId, mensagem } = req.body;
        const userId = req.session.user.uid;

        const solicitacoesNoMes = await verificarLimiteMensal(userId);
        if (solicitacoesNoMes >= 3) {
            return res.status(400).json({
                success: false,
                message: 'Você atingiu o limite de 3 solicitações por mês. Aguarde até o próximo mês.',
                limite: true
            });
        }

        // Buscar item
        const itemDoc = await db.collection('itens').doc(itemId).get();
        if (!itemDoc.exists) {
            return res.status(404).json({
                success: false,
                message: 'Item não encontrado'
            });
        }

        const item = itemDoc.data();

        if (item.status !== 'disponivel') {
            return res.status(400).json({
                success: false,
                message: 'Este item não está mais disponível'
            });
        }

        if (item.doadorId === userId) {
            return res.status(400).json({
                success: false,
                message: 'Você não pode solicitar seu próprio item'
            });
        }

        // Verifica se já existe uma solicitação pendente do mesmo usuário para o mesmo item
        const snapshotExistente = await db.collection('solicitacoes')
            .where('itemId', '==', itemId)
            .where('solicitanteId', '==', userId)
            .get();

        let pendenteJaExiste = false;
        if (!snapshotExistente.empty) {
            snapshotExistente.forEach(doc => {
                if (doc.data().status === 'pendente') {
                    pendenteJaExiste = true;
                }
            });
        }
    
        if (pendenteJaExiste) {
            return res.status(400).json({
                success: false,
                message: 'Você já tem uma solicitação pendente para este item'
            });
        }

        // Criar solicitação
        const novaSolicitacao = {
            itemId,
            itemNome: item.nome,
            itemImagem: item.imagens?.[0] || null,
            solicitanteId: userId,
            solicitanteNome: req.session.user.displayName,
            solicitanteEmail: req.session.user.email,
            doadorId: item.doadorId,
            doadorNome: item.doadorNome,
            mensagem: mensagem || '',
            status: 'pendente', 
            criadoEm: new Date().toISOString(),
            timestamp: Date.now()
        };

        const docRef = await db.collection('solicitacoes').add(novaSolicitacao);

        // [CORREÇÃO] Marcar item como 'reservado' APENAS se for a primeira solicitação pendente
        // A lógica original já fazia isso, mas o comentário estava confuso.
        // Se a solicitação foi criada, o item deve ser reservado.
        await db.collection('itens').doc(itemId).update({
            status: 'reservado',
            atualizadoEm: new Date().toISOString()
        });

        res.json({
            success: true,
            message: 'Solicitação enviada com sucesso!',
            solicitacaoId: docRef.id
        });

    } catch (error) {
        console.error('Erro ao criar solicitação:', error);
        res.status(500).json({
            success: false,
            message: 'Erro ao criar solicitação'
        });
    }
});

// Listar solicitações do usuário (recebidas e enviadas)
router.get('/minhas', requireAuth, async (req, res) => {
    try {
        const userId = req.session.user.uid;
        const tipo = req.query.tipo || 'recebidas'; 

        let query;
        if (tipo === 'recebidas') {
            query = db.collection('solicitacoes').where('doadorId', '==', userId);
        } else {
            query = db.collection('solicitacoes').where('solicitanteId', '==', userId);
        }

        // Faz a consulta simples (sem .orderBy())
        const snapshot = await query.get();
        
        const solicitacoes = [];
        snapshot.forEach(doc => {
            solicitacoes.push({ id: doc.id, ...doc.data() });
        });

        // Ordena os resultados em JAVASCRIPT
        solicitacoes.sort((a, b) => b.timestamp - a.timestamp);

        const solicitacoesNoMes = await verificarLimiteMensal(userId);

        res.json({
            success: true,
            solicitacoes,
            limite: {
                usado: solicitacoesNoMes,
                total: 3,
                restante: 3 - solicitacoesNoMes
            }
        });

    } catch (error) {
        console.error('Erro ao listar solicitações:', error);
        res.status(500).json({
            success: false,
            message: 'Erro ao listar solicitações'
        });
    }
});

// Aprovar solicitação e definir dados de coleta
router.post('/:id/aprovar', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const { endereco, dataColeta, horario, observacoes } = req.body;
        const userId = req.session.user.uid;

        const solicitacaoRef = db.collection('solicitacoes').doc(id);
        const solicitacaoDoc = await solicitacaoRef.get();

        if (!solicitacaoDoc.exists) {
            return res.status(404).json({
                success: false,
                message: 'Solicitação não encontrada'
            });
        }

        const solicitacao = solicitacaoDoc.data();

        if (solicitacao.doadorId !== userId) {
            return res.status(403).json({
                success: false,
                message: 'Você não tem permissão para aprovar esta solicitação'
            });
        }

        if (!endereco || !dataColeta || !horario) {
            return res.status(400).json({
                success: false,
                message: 'Preencha todos os campos obrigatórios'
            });
        }

        await solicitacaoRef.update({
            status: 'aprovada',
            aprovadoEm: new Date().toISOString(),
            dadosColeta: {
                endereco,
                dataColeta,
                horario,
                observacoes: observacoes || ''
            }
        });

        res.json({
            success: true,
            message: 'Solicitação aprovada! O interessado foi notificado.'
        });

    } catch (error) {
        console.error('Erro ao aprovar solicitação:', error);
        res.status(500).json({
            success: false,
            message: 'Erro ao aprovar solicitação'
        });
    }
});

// Recusar solicitação
router.post('/:id/recusar', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const { motivo } = req.body;
        const userId = req.session.user.uid;

        const solicitacaoRef = db.collection('solicitacoes').doc(id);
        const solicitacaoDoc = await solicitacaoRef.get();

        if (!solicitacaoDoc.exists) {
            return res.status(404).json({
                success: false,
                message: 'Solicitação não encontrada'
            });
        }

        const solicitacao = solicitacaoDoc.data();

        if (solicitacao.doadorId !== userId) {
            return res.status(403).json({
                success: false,
                message: 'Você não tem permissão'
            });
        }
        
        // Apenas recusa se estiver pendente
        if (solicitacao.status !== 'pendente') {
            return res.status(400).json({
                success: false,
                message: 'Esta solicitação já foi aprovada ou cancelada.'
            });
        }

        await solicitacaoRef.update({
            status: 'recusada',
            recusadoEm: new Date().toISOString(),
            motivoRecusa: motivo || ''
        });

        // Retornar item para disponível
        await db.collection('itens').doc(solicitacao.itemId).update({
            status: 'disponivel'
        });

        res.json({
            success: true,
            message: 'Solicitação recusada'
        });

    } catch (error) {
        console.error('Erro ao recusar solicitação:', error);
        res.status(500).json({
            success: false,
            message: 'Erro ao recusar solicitação'
        });
    }
});

// Confirmar coleta (doador marca como coletado)
router.post('/:id/confirmar-coleta', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.session.user.uid;

        const solicitacaoRef = db.collection('solicitacoes').doc(id);
        const solicitacaoDoc = await solicitacaoRef.get();

        if (!solicitacaoDoc.exists) {
            return res.status(404).json({
                success: false,
                message: 'Solicitação não encontrada'
            });
        }

        const solicitacao = solicitacaoDoc.data();

        if (solicitacao.doadorId !== userId) {
            return res.status(403).json({
                success: false,
                message: 'Você não tem permissão para confirmar a coleta'
            });
        }

        if (solicitacao.status !== 'aprovada') {
            return res.status(400).json({
                success: false,
                message: 'A coleta só pode ser confirmada para solicitações aprovadas.'
            });
        }

        // 1️⃣ Atualiza o status da solicitação
        await solicitacaoRef.update({
            status: 'coletada',
            coletadoEm: new Date().toISOString()
        });

        // 2️⃣ Atualiza o status do item para 'doado'
        await db.collection('itens').doc(solicitacao.itemId).update({
            status: 'doado',
            atualizadoEm: new Date().toISOString()
        });

        // 3️⃣ Cancela todas as outras solicitações pendentes para o mesmo item
        const outrasSolicitacoesSnapshot = await db.collection('solicitacoes')
            .where('itemId', '==', solicitacao.itemId)
            .where('status', '==', 'pendente')
            .get();

        const batch = db.batch();
        outrasSolicitacoesSnapshot.forEach(doc => {
            batch.update(doc.ref, {
                status: 'cancelada',
                motivoCancelamento: 'Item doado para outro solicitante.'
            });
        });
        await batch.commit();

        // Linha removida (updateGlobalCounter)

        res.json({
            success: true,
            message: 'Coleta confirmada. Item marcado como doado.'
        });

    } catch (error) {
        console.error('Erro ao confirmar coleta:', error);
        res.status(500).json({
            success: false,
            message: 'Erro ao confirmar coleta'
        });
    }
});

// Cancelar solicitação (solicitante cancela)
router.post('/:id/cancelar', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.session.user.uid;

        const solicitacaoRef = db.collection('solicitacoes').doc(id);
        const solicitacaoDoc = await solicitacaoRef.get();

        if (!solicitacaoDoc.exists) {
            return res.status(404).json({
                success: false,
                message: 'Solicitação não encontrada'
            });
        }

        const solicitacao = solicitacaoDoc.data();

        if (solicitacao.solicitanteId !== userId) {
            return res.status(403).json({
                success: false,
                message: 'Você não tem permissão para cancelar esta solicitação'
            });
        }

        if (solicitacao.status === 'coletada' || solicitacao.status === 'recusada' || solicitacao.status === 'cancelada') {
            return res.status(400).json({
                success: false,
                message: `Esta solicitação já está no status: ${solicitacao.status}`
            });
        }

        // 1. Atualiza o status da solicitação
        await solicitacaoRef.update({
            status: 'cancelada',
            canceladoEm: new Date().toISOString()
        });

        // 2. Verifica se há outras solicitações pendentes para o item
        const outrasSolicitacoesSnapshot = await db.collection('solicitacoes')
            .where('itemId', '==', solicitacao.itemId)
            .where('status', '==', 'pendente')
            .get();

        // 3. Se não houver mais solicitações pendentes, o item volta a ser 'disponivel'
        if (outrasSolicitacoesSnapshot.empty) {
            await db.collection('itens').doc(solicitacao.itemId).update({
                status: 'disponivel',
                atualizadoEm: new Date().toISOString()
            });
        }
        // Se houver outras solicitações pendentes, o item permanece 'reservado'

        res.json({
            success: true,
            message: 'Solicitação cancelada com sucesso. O item voltou a ficar disponível (se não houver outras solicitações pendentes).'
        });

    } catch (error) {
        console.error('Erro ao cancelar solicitação:', error);
        res.status(500).json({
            success: false,
            message: 'Erro ao cancelar solicitação'
        });
    }
});

export default router;
