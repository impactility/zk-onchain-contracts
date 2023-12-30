import { expect } from 'chai';
import { ethers } from 'hardhat';
import {
  deployERC20LinkedUniversalVerifier,
  deployERC20ZKPVerifierToken,
  deployValidatorContracts,
  prepareInputs,
  publishState
} from '../utils/deploy-utils';
import { packValidatorParams, unpackValidatorParams } from '../utils/pack-utils';

const tenYears = 315360000;
describe('ERC 20 test', function () {
  let state: any, sig: any, mtp: any;

  before(async () => {
    const contractsSig = await deployValidatorContracts(
      'VerifierSigWrapper',
      'CredentialAtomicQuerySigValidator'
    );
    state = contractsSig.state;
    sig = contractsSig.validator;

    const contractsMTP = await deployValidatorContracts(
      'VerifierMTPWrapper',
      'CredentialAtomicQueryMTPValidator',
      state.address
    );
    mtp = contractsMTP.validator;

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    await publishState(state, require('./common-data/user_state_transition.json'));
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    await publishState(state, require('./common-data/issuer_genesis_state.json'));
  });

  async function erc20VerifierFlow(
    callBack: (q, t) => Promise<void>,
    validator: 'credentialAtomicQueryMTPV2OnChain' | 'credentialAtomicQuerySigV2OnChain'
  ): Promise<void> {
    const { universalVerifier, erc20LinkedUniversalVerifier: token } =
      await deployERC20LinkedUniversalVerifier('zkpVerifier' + validator, 'ZKP' + validator);

    const { inputs, pi_a, pi_b, pi_c } = prepareInputs(
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      validator === 'credentialAtomicQuerySigV2OnChain'
        ? require('./common-data/valid_sig_user_non_genesis_challenge_address.json')
        : require('./common-data/valid_mtp_user_non_genesis_challenge_address.json')
    );

    const account = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
    expect(token.transfer).not.to.be.undefined;
    expect(universalVerifier.submitZKPResponse).not.to.be.undefined;

    // try transfer without given proof

    await expect(
      token.transfer('0x900942Fd967cf176D0c0A1302ee0722e1468f580', 1)
    ).to.be.revertedWith(
      'only identities who provided sig or mtp proof for transfer requests are allowed to receive tokens'
    );
    expect(await token.balanceOf(account)).to.equal(0);

    // must be no queries
    console.log('supported requests - zero');

    expect(await universalVerifier.getZKPRequestsCount()).to.be.equal(0);

    // set transfer request id

    const query = {
      schema: ethers.BigNumber.from('180410020913331409885634153623124536270'),
      claimPathKey: ethers.BigNumber.from(
        '8566939875427719562376598811066985304309117528846759529734201066483458512800'
      ),
      operator: ethers.BigNumber.from(1),
      slotIndex: ethers.BigNumber.from(0),
      value: ['1420070400000000000', ...new Array(63).fill('0')].map((x) =>
        ethers.BigNumber.from(x)
      ),
      circuitIds: [validator],
      queryHash: ethers.BigNumber.from(
        '1496222740463292783938163206931059379817846775593932664024082849882751356658'
      ),
      claimPathNotExists: 0,
      metadata: 'test medatada',
      skipClaimRevocationCheck: validator === 'credentialAtomicQuerySigV2OnChain' ? false : true
    };

    const requestId =
      validator === 'credentialAtomicQuerySigV2OnChain'
        ? await token.TRANSFER_REQUEST_ID_SIG_VALIDATOR()
        : await token.TRANSFER_REQUEST_ID_MTP_VALIDATOR();
    expect(requestId).to.be.equal(validator === 'credentialAtomicQuerySigV2OnChain' ? 0 : 1);

    await callBack(query, universalVerifier);

    const requestData = await universalVerifier.getZKPRequest(requestId);
    const parsed = unpackValidatorParams(requestData.data);

    expect(parsed.queryHash.toString()).to.be.equal(query.queryHash);
    expect(parsed.claimPathKey.toString()).to.be.equal(query.claimPathKey.toString());
    expect(parsed.circuitIds[0].toString()).to.be.equal(query.circuitIds[0].toString());
    expect(parsed.operator.toString()).to.be.equal(query.operator.toString());
    expect(parsed.claimPathNotExists.toString()).to.be.equal(query.claimPathNotExists.toString());
    // check that query is assigned
    expect(await universalVerifier.getZKPRequestsCount()).to.be.equal(1);

    console.log('supported requests - one');

    await universalVerifier.submitZKPResponse(requestId, inputs, pi_a, pi_b, pi_c);
    expect(await universalVerifier.getProofStatus(account, requestId)).to.be.true; // check proof is assigned

    // check that tokens were minted
    token.mint(account);
    expect(await token.balanceOf(account)).to.equal(ethers.BigNumber.from('5000000000000000000'));

    // if proof is provided second time, address is not receiving airdrop tokens, but no revert
    await universalVerifier.submitZKPResponse(requestId, inputs, pi_a, pi_b, pi_c);

    expect(await token.balanceOf(account)).to.equal(ethers.BigNumber.from('5000000000000000000'));

    await token.transfer(account, 1); // we send tokens to ourselves, but no error because we sent proof
    expect(await token.balanceOf(account)).to.equal(ethers.BigNumber.from('5000000000000000000'));
  }

  it('Example ERC20 Verifier: set zkp request Sig validator', async () => {
    await sig.setProofExpirationTimeout(tenYears);
    await erc20VerifierFlow(async (query, universalVerifier) => {
      await universalVerifier.addZKPRequest({
        metadata: 'metadata',
        validator: sig.address,
        data: packValidatorParams(query)
      });
    }, 'credentialAtomicQuerySigV2OnChain');
  });

  it('Example ERC20 Verifier: set zkp request Mtp validator', async () => {
    await mtp.setProofExpirationTimeout(tenYears);
    await erc20VerifierFlow(async (query, universalVerifier) => {
      await universalVerifier.addZKPRequest({
        metadata: 'metadata',
        validator: mtp.address,
        data: packValidatorParams(query)
      });
    }, 'credentialAtomicQueryMTPV2OnChain');
  });
});
